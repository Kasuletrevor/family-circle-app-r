import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isGuardianAngelTemplate, type GuardianAngelCatalogResult, type GuardianAngelTemplate } from '../../shared/agentic'
import { sanitizeCatalog } from './catalogSanitizer'
import { limitedRequest } from './limitedRequest'

export const CATALOG_URL = 'https://agentback.kin-keepers.ai/api/agno/agents/public'
export const TEMPLATE_SITE = 'https://kin-keepers.ai'
const MAX_LIST_BYTES = 2 * 1024 * 1024
const MAX_AVATAR_BYTES = 512 * 1024
const MAX_TOTAL_AVATAR_BYTES = 8 * 1024 * 1024
const MAX_TEMPLATES = 100
const AVATAR_DOWNLOADS_AT_ONCE = 6
const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MEMORY_LIFETIME_MS = 30 * 60 * 1000

export interface GuardianAngelCatalogDeps {
  fetch: typeof fetch
  cachePath: string
  now?: () => number
  timeoutMs?: number
  /** Overall time allowed for avatars; images are optional, so they never hold up the list for long. */
  avatarBudgetMs?: number
}

interface SavedCatalog { version: 1; fetchedAt: number; templates: GuardianAngelTemplate[] }

/** The public Guardian Angel templates, with the last good copy kept for offline use. */
export class GuardianAngelCatalog {
  private memory: SavedCatalog | null = null
  private lastFetchFailed = false
  private inFlight: Promise<GuardianAngelCatalogResult> | null = null
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
    // Repeated Retry clicks share one download, so the size and time limits hold overall.
    this.inFlight ??= this.refresh().finally(() => { this.inFlight = null })
    return this.inFlight
  }

  private async refresh(): Promise<GuardianAngelCatalogResult> {
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

  /** Downloads a successful response of at most `maxBytes`, with the timeout over the whole body. */
  private async download(url: string, maxBytes: number, timeoutMs = this.timeoutMs): Promise<{ bytes: Buffer; type: string }> {
    const response = await limitedRequest(this.deps.fetch, url, {}, { maxBytes, timeoutMs })
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
    return response
  }

  private async fetchTemplates(): Promise<GuardianAngelTemplate[]> {
    const { bytes } = await this.download(CATALOG_URL, MAX_LIST_BYTES)
    const entries = sanitizeCatalog(JSON.parse(bytes.toString('utf8'))).slice(0, MAX_TEMPLATES)
    if (entries.length === 0) throw new Error('No templates')
    const templates: GuardianAngelTemplate[] = entries.map(({ template }) => ({ ...template, avatar: null }))

    // A few downloads at a time, and a total budget, so a huge list cannot exhaust memory.
    let next = 0
    let avatarBytes = 0
    const deadline = Date.now() + (this.deps.avatarBudgetMs ?? 8_000)
    const worker = async () => {
      while (next < entries.length && avatarBytes < MAX_TOTAL_AVATAR_BYTES) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) break
        const index = next++
        const path = entries[index]!.avatarPath
        if (!path) continue
        const avatar = await this.fetchAvatar(path, Math.min(this.timeoutMs, remaining))
        if (!avatar) continue
        if (avatarBytes + avatar.bytes > MAX_TOTAL_AVATAR_BYTES) {
          avatarBytes = MAX_TOTAL_AVATAR_BYTES
          break
        }
        avatarBytes += avatar.bytes
        templates[index]!.avatar = avatar.dataUrl
      }
    }
    await Promise.all(Array.from({ length: AVATAR_DOWNLOADS_AT_ONCE }, worker))
    return templates
  }

  private async fetchAvatar(path: string, timeoutMs: number): Promise<{ dataUrl: string; bytes: number } | null> {
    try {
      const { bytes, type } = await this.download(`${TEMPLATE_SITE}${path}`, MAX_AVATAR_BYTES, timeoutMs)
      if (!AVATAR_TYPES.has(type) || bytes.length === 0) return null
      return { dataUrl: `data:${type};base64,${bytes.toString('base64')}`, bytes: bytes.length }
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
