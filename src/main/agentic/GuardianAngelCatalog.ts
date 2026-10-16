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

  private async request(url: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.deps.fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'error' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response
    } finally {
      clearTimeout(timer)
    }
  }

  private async fetchTemplates(): Promise<GuardianAngelTemplate[]> {
    const response = await this.request(CATALOG_URL)
    const text = await response.text()
    if (text.length > MAX_LIST_BYTES) throw new Error('Catalog too large')
    const entries = sanitizeCatalog(JSON.parse(text))
    if (entries.length === 0) throw new Error('No templates')
    return Promise.all(entries.map(async ({ template, avatarPath }) => ({
      ...template,
      avatar: avatarPath ? await this.fetchAvatar(avatarPath) : null,
    })))
  }

  private async fetchAvatar(path: string): Promise<string | null> {
    try {
      const response = await this.request(`${TEMPLATE_SITE}${path}`)
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      if (!AVATAR_TYPES.has(type)) return null
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return null
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
