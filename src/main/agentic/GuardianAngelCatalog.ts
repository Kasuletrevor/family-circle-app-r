import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isGuardianAngelTemplate, type GuardianAngelCatalogResult, type GuardianAngelTemplate } from '../../shared/agentic'
import { sanitizeCatalog } from './catalogSanitizer'

export const CATALOG_URL = 'https://agentback.kin-keepers.ai/api/agno/agents/public'
export const TEMPLATE_SITE = 'https://kin-keepers.ai'
const MAX_LIST_BYTES = 2 * 1024 * 1024
const MAX_AVATAR_BYTES = 512 * 1024
const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MEMORY_LIFETIME_MS = 30 * 60 * 1000

export interface GuardianAngelCatalogDeps {
  fetch: typeof fetch
  cachePath: string
  now?: () => number
  timeoutMs?: number
}

interface SavedCatalog { version: 1; fetchedAt: number; templates: GuardianAngelTemplate[] }

/** The public Guardian Angel templates, with the last good copy kept for offline use. */
export class GuardianAngelCatalog {
  private memory: SavedCatalog | null = null
  private lastFetchFailed = false
  private readonly now: () => number
  private readonly timeoutMs: number

  constructor(private readonly deps: GuardianAngelCatalogDeps) {
    this.now = deps.now ?? Date.now
    this.timeoutMs = deps.timeoutMs ?? 10_000
  }

  async get(options: { refresh?: boolean } = {}): Promise<GuardianAngelCatalogResult> {
    if (!options.refresh && !this.lastFetchFailed && this.memory && this.now() - this.memory.fetchedAt < MEMORY_LIFETIME_MS) {
      return { status: 'ready', templates: this.memory.templates, fetchedAt: this.memory.fetchedAt, stale: false }
    }
    try {
      const templates = await this.fetchTemplates()
      const saved: SavedCatalog = { version: 1, fetchedAt: this.now(), templates }
      this.memory = saved
      this.lastFetchFailed = false
      await this.save(saved).catch(() => undefined)
      return { status: 'ready', templates, fetchedAt: saved.fetchedAt, stale: false }
    } catch {
      // A copy shown after a failure is always labelled stale, and the next request retries.
      this.lastFetchFailed = true
      const saved = this.memory ?? await this.load()
      return saved
        ? { status: 'ready', templates: saved.templates, fetchedAt: saved.fetchedAt, stale: true }
        : { status: 'unavailable' }
    }
  }

  /**
   * Downloads a response of at most `maxBytes`. The timeout covers the whole body, and the
   * body is read in chunks so an oversized or endless response is never held in memory.
   */
  private async download(url: string, maxBytes: number): Promise<{ bytes: Buffer; type: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.deps.fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'error' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new Error('Response too large')
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Empty response')
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) {
          void reader.cancel().catch(() => undefined)
          throw new Error('Response too large')
        }
        chunks.push(value)
      }
      return { bytes: Buffer.concat(chunks), type }
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }

  private async fetchTemplates(): Promise<GuardianAngelTemplate[]> {
    const { bytes } = await this.download(CATALOG_URL, MAX_LIST_BYTES)
    const entries = sanitizeCatalog(JSON.parse(bytes.toString('utf8')))
    if (entries.length === 0) throw new Error('No templates')
    return Promise.all(entries.map(async ({ template, avatarPath }) => ({
      ...template,
      avatar: avatarPath ? await this.fetchAvatar(avatarPath) : null,
    })))
  }

  private async fetchAvatar(path: string): Promise<string | null> {
    try {
      const { bytes, type } = await this.download(`${TEMPLATE_SITE}${path}`, MAX_AVATAR_BYTES)
      if (!AVATAR_TYPES.has(type) || bytes.length === 0) return null
      return `data:${type};base64,${bytes.toString('base64')}`
    } catch {
      return null
    }
  }

  private async save(saved: SavedCatalog): Promise<void> {
    await mkdir(dirname(this.deps.cachePath), { recursive: true })
    const temporary = `${this.deps.cachePath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(saved))
    await rename(temporary, this.deps.cachePath)
  }

  private async load(): Promise<SavedCatalog | null> {
    try {
      const raw = JSON.parse(await readFile(this.deps.cachePath, 'utf8')) as Partial<SavedCatalog>
      if (raw.version !== 1 || typeof raw.fetchedAt !== 'number' || !Array.isArray(raw.templates)) return null
      if (raw.templates.length === 0 || !raw.templates.every(isGuardianAngelTemplate)) return null
      this.memory = { version: 1, fetchedAt: raw.fetchedAt, templates: raw.templates }
      return this.memory
    } catch {
      return null
    }
  }
}
