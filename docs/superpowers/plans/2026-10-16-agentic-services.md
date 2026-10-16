# Agentic Services (catalog + secure views) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a green COMMAND mode with a native Guardian Angel template catalog and in-app, isolated web views for Guardian Angel (kin-keepers.ai), UberCare and Marketplace.

**Architecture:** The main process fetches and sanitizes the public template list (with a disk cache) and owns one sandboxed `WebContentsView` per partner service, positioned over a slot the renderer measures. The renderer reaches both only through `window.familyCircle.agentic` via `DesktopAgenticClient`. `/agentic/*` routes switch the shell to `data-mode="command"`, which swaps the accent tokens to green.

**Tech Stack:** Electron 44 (`WebContentsView`, `session.fromPartition`), React 19 + react-router, Vitest + Testing Library (jsdom), TypeScript.

Spec: `docs/superpowers/specs/2026-10-16-agentic-services-design.md`.

## Global Constraints

- No family data is sent to any partner or template service. The catalog request carries no credentials or cookies.
- Never expose `created_by`, `model`, `tools` or any other field outside the `GuardianAngelTemplate` shape.
- The renderer names services by key (`guardian-angel`, `ubercare`, `marketplace`), never by URL.
- Partner views: no preload, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`; main-frame navigation only to the service's allowed hosts over HTTPS; pop-ups always denied; permissions denied; downloads cancelled.
- Partner sessions are per Family Circle account: partition `persist:agentic-{group}-{accountKey}` where `accountKey` = first 16 hex chars of sha256 of the local user id.
- Only `src/renderer/services/agentic/DesktopAgenticClient.ts` may reference `window.familyCircle.agentic`.
- Command green: `--kk-accent: #15803d`, sidebar `#0f3d2c`. Gold `#e6ad69` unchanged. Minimum text size 13px.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Commands

- Tests (Node 24): `N=/c/Users/kasul/AppData/Local/npm-cache/_npx/387698761821791d/node_modules/node/bin/node.exe; $N node_modules/vitest/vitest.mjs run <path>`
- `npm run -s typecheck`, `node scripts/verify-boundaries.mjs`, `npm run -s build`
- Known flaky 5 s timeouts under full-suite load (#7): PasswordHasher, AuthService, PasswordRecovery, App navigation, MyStory schema, CircleManagement. Re-run those in isolation.

## File map

| File | Responsibility |
|---|---|
| `src/shared/agentic.ts` | Public types, service keys, categories, template validator |
| `src/main/agentic/catalogSanitizer.ts` | Raw API JSON → safe templates + avatar paths |
| `src/main/agentic/GuardianAngelCatalog.ts` | Fetch, avatars, cache, offline fallback |
| `src/main/agentic/partnerServices.ts` | Service table, `decideNavigation`, target URLs, bounds clamp |
| `src/main/agentic/PartnerViews.ts` | View lifecycle per account; visibility, bounds, commands |
| `src/main/agentic/electronPartnerViewHost.ts` | Thin Electron host: `WebContentsView` + security guards |
| `src/main/agentic/agenticIpc.ts` | IPC handlers with input validation |
| `src/main/main.ts` | Wiring |
| `src/shared/desktopApi.ts`, `src/preload/createDesktopApi.ts` | `agentic` bridge |
| `scripts/verify-boundaries.mjs` | Boundary rule |
| `src/renderer/services/agentic/AgenticClient.ts`, `DesktopAgenticClient.ts` | Renderer client |
| `src/renderer/app/services.tsx` | `agentic` service |
| `src/renderer/test/fakeAgenticClient.ts` | Test fake |
| `src/renderer/app/App.tsx`, `Sidebar.tsx`, `App.css` | Routes, command mode, sidebar group, green tokens |
| `src/renderer/features/agentic/GuardianAngelPage.tsx` | Native catalog |
| `src/renderer/features/agentic/PartnerViewPage.tsx`, `useOverlayOpen.ts` | View host page |
| `src/renderer/features/agentic/agentic.css` | Page styles |

---

### Task 1: Shared contract and catalog sanitizer

**Files:**
- Create: `src/shared/agentic.ts`
- Create: `src/main/agentic/catalogSanitizer.ts`
- Test: `src/main/agentic/catalogSanitizer.test.ts`

**Interfaces:**
- Produces (`src/shared/agentic.ts`): `PartnerServiceKey`, `PARTNER_SERVICE_KEYS`, `isPartnerServiceKey(v)`, `GuardianAngelCategory`, `GUARDIAN_ANGEL_CATEGORIES`, `GuardianAngelTemplate`, `GuardianAngelCatalogResult`, `PartnerViewTarget`, `PartnerViewState`, `PartnerViewStatus`, `PartnerViewBounds`, `PartnerViewCommand`, `TEMPLATE_ID`, `AVATAR_DATA_URL`, `isGuardianAngelTemplate(v)`.
- Produces (`catalogSanitizer.ts`): `sanitizeCatalog(raw: unknown): SanitizedTemplate[]` where `SanitizedTemplate = { template: Omit<GuardianAngelTemplate, 'avatar'>; avatarPath: string | null }`; `humanizeRule(value: string): string`.

- [ ] **Step 1: Write the shared contract**

`src/shared/agentic.ts`:

```ts
export type PartnerServiceKey = 'guardian-angel' | 'ubercare' | 'marketplace'
export const PARTNER_SERVICE_KEYS: readonly PartnerServiceKey[] = ['guardian-angel', 'ubercare', 'marketplace']

export function isPartnerServiceKey(value: unknown): value is PartnerServiceKey {
  return typeof value === 'string' && (PARTNER_SERVICE_KEYS as readonly string[]).includes(value)
}

export type GuardianAngelCategory =
  | 'elder_companion'
  | 'care_coordinator'
  | 'family_update'
  | 'post_visit'
  | 'medication_appointment'
  | 'other'

/** Display order and labels for the catalog. */
export const GUARDIAN_ANGEL_CATEGORIES: ReadonlyArray<{ key: GuardianAngelCategory; label: string }> = [
  { key: 'elder_companion', label: 'Elder companion' },
  { key: 'care_coordinator', label: 'Care coordinator' },
  { key: 'family_update', label: 'Family update' },
  { key: 'post_visit', label: 'After a visit' },
  { key: 'medication_appointment', label: 'Medication and appointments' },
  { key: 'other', label: 'Other' },
]

export interface GuardianAngelTemplate {
  id: string
  name: string
  description: string
  category: GuardianAngelCategory
  /** Plain sentences, e.g. "No medical advice". */
  trustBoundaries: string[]
  /** Plain sentences, e.g. "Self harm mentions". */
  escalationTriggers: string[]
  /** A PNG, JPEG or WebP data URL, or null to show initials. */
  avatar: string | null
}

export type GuardianAngelCatalogResult =
  | { status: 'ready'; templates: GuardianAngelTemplate[]; fetchedAt: number; stale: boolean }
  | { status: 'unavailable' }

export type PartnerViewTarget =
  | { kind: 'start' }
  | { kind: 'template'; templateId: string }
  | { kind: 'care-builder' }

export type PartnerViewState = 'loading' | 'ready' | 'failed'
export interface PartnerViewStatus { service: PartnerServiceKey; state: PartnerViewState; canGoBack: boolean }
export interface PartnerViewBounds { x: number; y: number; width: number; height: number }
export type PartnerViewCommand = 'back' | 'reload' | 'open-external'

export const TEMPLATE_ID = /^[1-9][0-9]{0,9}$/
export const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const CATEGORY_KEYS = new Set(GUARDIAN_ANGEL_CATEGORIES.map((category) => category.key))

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 12 && value.every((item) => typeof item === 'string' && item.length <= 200)
}

/** Checks the public template shape (used on cached copies and in the preload). */
export function isGuardianAngelTemplate(value: unknown): value is GuardianAngelTemplate {
  if (value == null || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return typeof raw.id === 'string' && TEMPLATE_ID.test(raw.id)
    && typeof raw.name === 'string' && raw.name.length > 0 && raw.name.length <= 120
    && typeof raw.description === 'string' && raw.description.length <= 600
    && typeof raw.category === 'string' && CATEGORY_KEYS.has(raw.category as GuardianAngelCategory)
    && isTextList(raw.trustBoundaries) && isTextList(raw.escalationTriggers)
    && (raw.avatar === null || (typeof raw.avatar === 'string' && AVATAR_DATA_URL.test(raw.avatar)))
}

/** Keeps only the public fields of a template, so nothing extra crosses a boundary. */
export function publicTemplate(template: GuardianAngelTemplate): GuardianAngelTemplate {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    trustBoundaries: [...template.trustBoundaries],
    escalationTriggers: [...template.escalationTriggers],
    avatar: template.avatar,
  }
}
```

- [ ] **Step 2: Write the failing sanitizer tests**

`src/main/agentic/catalogSanitizer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { humanizeRule, sanitizeCatalog } from './catalogSanitizer'

const curated = {
  id: 7,
  name: 'Elder Companion',
  slug: 'elder-companion',
  description: 'Warm, patient conversational presence',
  avatar_src: '/avatars/1999625.png',
  category: 'elder_companion',
  is_curated: true,
  model: 'gpt-4o-mini',
  tools: ['get_elder_profile', 'send_email'],
  created_by: 'someone@example.test',
  trust_boundaries: ['no_medical_advice', 'no_financial_decisions'],
  escalation_triggers: ['self_harm_mentions'],
}

describe('sanitizeCatalog', () => {
  it('keeps curated templates in the public shape only', () => {
    const [entry] = sanitizeCatalog([curated])
    expect(entry).toEqual({
      template: {
        id: '7',
        name: 'Elder Companion',
        description: 'Warm, patient conversational presence',
        category: 'elder_companion',
        trustBoundaries: ['No medical advice', 'No financial decisions'],
        escalationTriggers: ['Self harm mentions'],
      },
      avatarPath: '/avatars/1999625.png',
    })
    expect(JSON.stringify(entry)).not.toMatch(/example\.test|gpt-4o|send_email|slug/)
  })

  it('drops non-curated, invalid and duplicate entries without failing', () => {
    const result = sanitizeCatalog([
      { ...curated, id: 1, is_curated: false },
      { ...curated, id: 'abc' },
      { ...curated, id: 2, name: '   ' },
      null,
      { ...curated, id: 3 },
      { ...curated, id: 3, name: 'Duplicate' },
    ])
    expect(result.map((entry) => entry.template.id)).toEqual(['3'])
  })

  it('returns nothing for a response that is not a list', () => {
    expect(sanitizeCatalog({ agents: [curated] })).toEqual([])
  })

  it('maps unknown categories to other and caps text', () => {
    const [entry] = sanitizeCatalog([{
      ...curated,
      category: 'something_new',
      name: 'N'.repeat(300),
      description: 'D'.repeat(900),
      trust_boundaries: Array.from({ length: 20 }, (_, index) => `rule_${index}`),
      escalation_triggers: 'not a list',
    }])
    expect(entry!.template.category).toBe('other')
    expect(entry!.template.name).toHaveLength(120)
    expect(entry!.template.description).toHaveLength(600)
    expect(entry!.template.trustBoundaries).toHaveLength(12)
    expect(entry!.template.escalationTriggers).toEqual([])
  })

  it('accepts only simple avatar paths on the template site', () => {
    const avatar = (avatar_src: unknown) => sanitizeCatalog([{ ...curated, avatar_src }])[0]!.avatarPath
    expect(avatar('/avatars/a-1_b.jpg')).toBe('/avatars/a-1_b.jpg')
    expect(avatar('https://evil.test/a.png')).toBeNull()
    expect(avatar('/avatars/../secret.png')).toBeNull()
    expect(avatar('/avatars/a.svg')).toBeNull()
    expect(avatar(null)).toBeNull()
  })

  it('strips control characters', () => {
    const [entry] = sanitizeCatalog([{ ...curated, name: 'Elder\u0000 Companion\u202e' }])
    expect(entry!.template.name).toBe('Elder Companion')
  })
})

describe('humanizeRule', () => {
  it('turns rule keys into plain sentences', () => {
    expect(humanizeRule('no_memory_correction_unless_safety')).toBe('No memory correction unless safety')
    expect(humanizeRule('  Already a sentence. ')).toBe('Already a sentence.')
    expect(humanizeRule('___')).toBe('')
  })
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `$N node_modules/vitest/vitest.mjs run src/main/agentic/catalogSanitizer.test.ts`
Expected: FAIL, cannot resolve `./catalogSanitizer`.

- [ ] **Step 4: Implement the sanitizer**

`src/main/agentic/catalogSanitizer.ts`:

```ts
import { GUARDIAN_ANGEL_CATEGORIES, type GuardianAngelCategory, type GuardianAngelTemplate } from '../../shared/agentic'

export interface SanitizedTemplate {
  template: Omit<GuardianAngelTemplate, 'avatar'>
  avatarPath: string | null
}

const KNOWN_CATEGORIES = new Set<string>(GUARDIAN_ANGEL_CATEGORIES.map((category) => category.key))
const AVATAR_PATH = /^\/avatars\/[A-Za-z0-9_-]{1,80}\.(png|jpe?g|webp)$/
// C0/C1 controls plus bidi and zero-width formatting characters.
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(UNSAFE_CHARACTERS, '').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** "no_medical_advice" becomes "No medical advice"; sentences are kept as they are. */
export function humanizeRule(value: string): string {
  const text = cleanText(value.replace(/_/g, ' '), 200)
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}

function rules(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(humanizeRule)
    .filter(Boolean)
    .slice(0, 12)
}

function templateId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < 1e10) return String(value)
  if (typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value)) return value
  return null
}

/** Keeps curated templates from the public list, in the public shape only. */
export function sanitizeCatalog(raw: unknown): SanitizedTemplate[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const result: SanitizedTemplate[] = []
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    if (entry.is_curated !== true) continue
    const id = templateId(entry.id)
    const name = cleanText(entry.name, 120)
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    const category = typeof entry.category === 'string' && KNOWN_CATEGORIES.has(entry.category)
      ? entry.category as GuardianAngelCategory
      : 'other'
    result.push({
      template: {
        id,
        name,
        description: cleanText(entry.description, 600),
        category,
        trustBoundaries: rules(entry.trust_boundaries),
        escalationTriggers: rules(entry.escalation_triggers),
      },
      avatarPath: typeof entry.avatar_src === 'string' && AVATAR_PATH.test(entry.avatar_src) ? entry.avatar_src : null,
    })
  }
  return result
}
```

Note: write the `\u` escapes with the Edit tool or check the file afterwards; the Write tool turns `\uXXXX` into literal characters. Run `grep -c 'u0000' src/main/agentic/catalogSanitizer.ts` and expect `1`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `$N node_modules/vitest/vitest.mjs run src/main/agentic/catalogSanitizer.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/agentic.ts src/main/agentic/catalogSanitizer.ts src/main/agentic/catalogSanitizer.test.ts
git commit -m "feat: sanitize the public Guardian Angel template list"
```

---

### Task 2: GuardianAngelCatalog (fetch, avatars, cache)

**Files:**
- Create: `src/main/agentic/GuardianAngelCatalog.ts`
- Test: `src/main/agentic/GuardianAngelCatalog.test.ts`

**Interfaces:**
- Consumes: `sanitizeCatalog`, `isGuardianAngelTemplate`, `GuardianAngelCatalogResult`.
- Produces: `class GuardianAngelCatalog { constructor(deps: GuardianAngelCatalogDeps); get(options?: { refresh?: boolean }): Promise<GuardianAngelCatalogResult> }`, `GuardianAngelCatalogDeps = { fetch: typeof fetch; cachePath: string; now?: () => number; timeoutMs?: number }`, constants `CATALOG_URL`, `TEMPLATE_SITE`.

- [ ] **Step 1: Write the failing tests**

`src/main/agentic/GuardianAngelCatalog.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG_URL, GuardianAngelCatalog } from './GuardianAngelCatalog'

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const entry = (id: number, extra: Record<string, unknown> = {}) => ({
  id, name: `Angel ${id}`, description: 'Helps', category: 'family_update', is_curated: true,
  avatar_src: `/avatars/${id}.png`, trust_boundaries: ['no_medical_advice'], escalation_triggers: [],
  created_by: 'creator@example.test', ...extra,
})

function response(body: BodyInit, init: { status?: number; type?: string } = {}) {
  return new Response(body, { status: init.status ?? 200, headers: { 'content-type': init.type ?? 'application/json' } })
}

let folder: string
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'ga-catalog-')) })
afterEach(async () => { await rm(folder, { recursive: true, force: true }) })

function catalog(fetchImpl: typeof fetch, now = () => 1_000) {
  return new GuardianAngelCatalog({ fetch: fetchImpl, cachePath: join(folder, 'agentic', 'catalog.json'), now, timeoutMs: 50 })
}

describe('GuardianAngelCatalog', () => {
  it('fetches without credentials, inlines avatars and caches the result', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => (
      String(url) === CATALOG_URL
        ? response(JSON.stringify([entry(1), entry(2, { avatar_src: null })]))
        : response(PNG, { type: 'image/png' })
    )) as unknown as typeof fetch
    const result = await catalog(fetchImpl).get()

    expect(result).toMatchObject({ status: 'ready', stale: false, fetchedAt: 1_000 })
    if (result.status !== 'ready') throw new Error('expected ready')
    expect(result.templates[0]!.avatar).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
    expect(result.templates[1]!.avatar).toBeNull()
    expect(fetchImpl).toHaveBeenCalledWith(CATALOG_URL, expect.objectContaining({ credentials: 'omit', redirect: 'error' }))
    expect(fetchImpl).toHaveBeenCalledWith('https://kin-keepers.ai/avatars/1.png', expect.anything())
    const saved = await readFile(join(folder, 'agentic', 'catalog.json'), 'utf8')
    expect(saved).not.toContain('example.test')
  })

  it('skips avatars that are too large or not images', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === CATALOG_URL) return response(JSON.stringify([entry(1), entry(2)]))
      if (String(url).endsWith('/1.png')) return response(Buffer.alloc(600 * 1024), { type: 'image/png' })
      return response('<svg/>', { type: 'image/svg+xml' })
    }) as unknown as typeof fetch
    const result = await catalog(fetchImpl).get()
    if (result.status !== 'ready') throw new Error('expected ready')
    expect(result.templates.map((template) => template.avatar)).toEqual([null, null])
  })

  it('serves the saved copy as stale when the service cannot be reached', async () => {
    const ok = vi.fn(async (url: string | URL | Request) => (
      String(url) === CATALOG_URL ? response(JSON.stringify([entry(1)])) : response(PNG, { type: 'image/png' })
    )) as unknown as typeof fetch
    await catalog(ok).get()

    const offline = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    const result = await catalog(offline, () => 9_000).get()
    expect(result).toMatchObject({ status: 'ready', stale: true, fetchedAt: 1_000 })
  })

  it('treats bad JSON, error statuses and empty lists as failures', async () => {
    for (const body of [response('not json'), response('[]'), response('{}', { status: 500 })]) {
      const result = await catalog(vi.fn(async () => body.clone()) as unknown as typeof fetch).get()
      expect(result).toEqual({ status: 'unavailable' })
    }
  })

  it('times out a hanging request', async () => {
    const hanging = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as unknown as typeof fetch
    expect(await catalog(hanging).get()).toEqual({ status: 'unavailable' })
  })

  it('ignores a damaged saved copy', async () => {
    const cachePath = join(folder, 'catalog.json')
    await writeFile(cachePath, JSON.stringify({ version: 1, fetchedAt: 5, templates: [{ id: 'x' }] }))
    const offline = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    const result = await new GuardianAngelCatalog({ fetch: offline, cachePath, timeoutMs: 50 }).get()
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('reuses a fresh copy in memory unless asked to refresh', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => (
      String(url) === CATALOG_URL ? response(JSON.stringify([entry(1, { avatar_src: null })])) : response(PNG)
    )) as unknown as typeof fetch
    const service = catalog(fetchImpl)
    await service.get()
    await service.get()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await service.get({ refresh: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `$N node_modules/vitest/vitest.mjs run src/main/agentic/GuardianAngelCatalog.test.ts`
Expected: FAIL, cannot resolve `./GuardianAngelCatalog`.

- [ ] **Step 3: Implement**

`src/main/agentic/GuardianAngelCatalog.ts`:

```ts
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
```

Note: after a failed fetch, `lastFetchFailed` stops the in-memory copy from being served as fresh, so the next `get()` retries the network and a saved copy is always labelled stale.

- [ ] **Step 4: Run the tests to see them pass**

Run: `$N node_modules/vitest/vitest.mjs run src/main/agentic/GuardianAngelCatalog.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/agentic/GuardianAngelCatalog.ts src/main/agentic/GuardianAngelCatalog.test.ts
git commit -m "feat: fetch and cache the Guardian Angel catalog in the main process"
```

---

### Task 3: Partner service rules (pure)

**Files:**
- Create: `src/main/agentic/partnerServices.ts`
- Test: `src/main/agentic/partnerServices.test.ts`

**Interfaces:**
- Produces: `PARTNER_SERVICES: Record<PartnerServiceKey, { name: string; startUrl: string; hosts: readonly string[]; group: 'kin-keepers' | 'ubercare' }>`, `decideNavigation(service, url): 'allow' | 'external' | 'block'`, `targetUrl(service, target: PartnerViewTarget): string` (throws on invalid), `clampBounds(input: unknown, content: { width: number; height: number }): PartnerViewBounds` (throws on invalid), `partitionFor(service, accountKey): string`.

- [ ] **Step 1: Write the failing tests**

`src/main/agentic/partnerServices.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { clampBounds, decideNavigation, partitionFor, targetUrl } from './partnerServices'

describe('decideNavigation', () => {
  it('allows only the service hosts over HTTPS', () => {
    expect(decideNavigation('guardian-angel', 'https://kin-keepers.ai/templates/7')).toBe('allow')
    expect(decideNavigation('marketplace', 'https://www.kin-keepers.ai/')).toBe('allow')
    expect(decideNavigation('ubercare', 'https://remotecarers.net/worker/login')).toBe('allow')
  })

  it('sends other HTTPS sites to the browser', () => {
    expect(decideNavigation('ubercare', 'https://kin-keepers.ai/')).toBe('external')
    expect(decideNavigation('guardian-angel', 'https://kin-keepers.ai.evil.test/')).toBe('external')
    expect(decideNavigation('guardian-angel', 'https://evil.test/?kin-keepers.ai')).toBe('external')
  })

  it('blocks everything that is not HTTPS', () => {
    for (const url of ['http://kin-keepers.ai/', 'file:///C:/Windows', 'javascript:alert(1)', 'mailto:a@b.c', 'not a url', 'https://user:pw@kin-keepers.ai/']) {
      expect(decideNavigation('guardian-angel', url)).toBe('block')
    }
  })
})

describe('targetUrl', () => {
  it('builds the template, Care Builder and start pages', () => {
    expect(targetUrl('guardian-angel', { kind: 'template', templateId: '7' })).toBe('https://kin-keepers.ai/templates/7')
    expect(targetUrl('guardian-angel', { kind: 'care-builder' })).toBe('https://kin-keepers.ai/care-builder')
    expect(targetUrl('ubercare', { kind: 'start' })).toBe('https://remotecarers.net/worker/')
  })

  it('refuses bad template ids and templates outside Guardian Angel', () => {
    expect(() => targetUrl('guardian-angel', { kind: 'template', templateId: '../admin' })).toThrow()
    expect(() => targetUrl('ubercare', { kind: 'template', templateId: '7' })).toThrow()
    expect(() => targetUrl('ubercare', { kind: 'care-builder' })).toThrow()
  })
})

describe('clampBounds', () => {
  const content = { width: 1200, height: 800 }
  it('rounds and keeps the view inside the window', () => {
    expect(clampBounds({ x: 10.4, y: 20.6, width: 2000, height: 900 }, content)).toEqual({ x: 10, y: 21, width: 1190, height: 779 })
    expect(clampBounds({ x: -5, y: -5, width: 100, height: 100 }, content)).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })
  it('refuses missing or non-numeric values', () => {
    expect(() => clampBounds({ x: 'a', y: 0, width: 1, height: 1 }, content)).toThrow()
    expect(() => clampBounds({ x: Number.NaN, y: 0, width: 1, height: 1 }, content)).toThrow()
    expect(() => clampBounds(null, content)).toThrow()
  })
})

describe('partitionFor', () => {
  it('shares one Kin-Keepers session per account and keeps UberCare apart', () => {
    expect(partitionFor('guardian-angel', 'abc')).toBe('persist:agentic-kin-keepers-abc')
    expect(partitionFor('marketplace', 'abc')).toBe('persist:agentic-kin-keepers-abc')
    expect(partitionFor('ubercare', 'abc')).toBe('persist:agentic-ubercare-abc')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `$N node_modules/vitest/vitest.mjs run src/main/agentic/partnerServices.test.ts`
Expected: FAIL, cannot resolve `./partnerServices`.

- [ ] **Step 3: Implement**

`src/main/agentic/partnerServices.ts`:

```ts
import { TEMPLATE_ID, type PartnerServiceKey, type PartnerViewBounds, type PartnerViewTarget } from '../../shared/agentic'

interface PartnerService {
  name: string
  startUrl: string
  hosts: readonly string[]
  /** Services in one group share a session, so people sign in once. */
  group: 'kin-keepers' | 'ubercare'
}

const KIN_KEEPERS_HOSTS = ['kin-keepers.ai', 'www.kin-keepers.ai'] as const

export const PARTNER_SERVICES: Record<PartnerServiceKey, PartnerService> = {
  'guardian-angel': { name: 'Guardian Angel', startUrl: 'https://kin-keepers.ai/', hosts: KIN_KEEPERS_HOSTS, group: 'kin-keepers' },
  ubercare: { name: 'UberCare', startUrl: 'https://remotecarers.net/worker/', hosts: ['remotecarers.net', 'www.remotecarers.net'], group: 'ubercare' },
  marketplace: { name: 'Marketplace', startUrl: 'https://kin-keepers.ai/', hosts: KIN_KEEPERS_HOSTS, group: 'kin-keepers' },
}

/** Where a main-frame navigation in a partner view may go. */
export function decideNavigation(service: PartnerServiceKey, url: string): 'allow' | 'external' | 'block' {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'block'
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return 'block'
  return PARTNER_SERVICES[service].hosts.includes(parsed.hostname) ? 'allow' : 'external'
}

export function targetUrl(service: PartnerServiceKey, target: PartnerViewTarget): string {
  if (target.kind === 'start') return PARTNER_SERVICES[service].startUrl
  if (service !== 'guardian-angel') throw new Error('Only Guardian Angel has template pages')
  if (target.kind === 'care-builder') return 'https://kin-keepers.ai/care-builder'
  if (!TEMPLATE_ID.test(target.templateId)) throw new Error('Invalid template')
  return `https://kin-keepers.ai/templates/${target.templateId}`
}

export function clampBounds(input: unknown, content: { width: number; height: number }): PartnerViewBounds {
  const raw = input != null && typeof input === 'object' ? input as Record<string, unknown> : null
  const values = raw ? [raw.x, raw.y, raw.width, raw.height] : []
  if (values.length !== 4 || !values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('Invalid view bounds')
  }
  const [x, y, width, height] = (values as number[]).map(Math.round) as [number, number, number, number]
  const left = Math.min(Math.max(0, x), content.width)
  const top = Math.min(Math.max(0, y), content.height)
  return {
    x: left,
    y: top,
    width: Math.max(0, Math.min(width, content.width - left)),
    height: Math.max(0, Math.min(height, content.height - top)),
  }
}

export function partitionFor(service: PartnerServiceKey, accountKey: string): string {
  return `persist:agentic-${PARTNER_SERVICES[service].group}-${accountKey}`
}
```

- [ ] **Step 4: Run to see it pass**

Run: `$N node_modules/vitest/vitest.mjs run src/main/agentic/partnerServices.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agentic/partnerServices.ts src/main/agentic/partnerServices.test.ts
git commit -m "feat: navigation and session rules for partner services"
```

---

### Task 4: PartnerViews manager, Electron host, IPC and main wiring

**Files:**
- Create: `src/main/agentic/PartnerViews.ts`, `src/main/agentic/electronPartnerViewHost.ts`, `src/main/agentic/agenticIpc.ts`
- Modify: `src/main/main.ts`
- Test: `src/main/agentic/PartnerViews.test.ts`, `src/main/agentic/agenticIpc.test.ts`

**Interfaces:**
- Consumes: `PARTNER_SERVICES`, `decideNavigation`, `targetUrl`, `clampBounds`, `partitionFor`, `GuardianAngelCatalog`.
- Produces:
  - `interface PartnerViewHandle { load(url: string): void; setBounds(bounds: PartnerViewBounds): void; setVisible(visible: boolean): void; goBack(): void; currentUrl(): string; destroy(): void }`
  - `interface PartnerViewsHost { createView(service, partition, onStatus: (state: PartnerViewState, canGoBack: boolean) => void): PartnerViewHandle; openExternal(url: string): void; contentSize(): { width: number; height: number } }`
  - `class PartnerViews { constructor(deps: { host: PartnerViewsHost; accountKey(): Promise<string | null>; emit(status: PartnerViewStatus): void }); open(service, target?): Promise<void>; setBounds(service, bounds: unknown): void; hide(service): void; command(service, command): void; destroyAll(): void }`
  - `registerAgenticIpc(ipc: IpcHandleRegistrar, deps: { catalog: { get(o?: { refresh?: boolean }): Promise<GuardianAngelCatalogResult> }; views: Pick<PartnerViews, 'open' | 'setBounds' | 'hide' | 'command'> })`
  - `createElectronPartnerViewHost(window: BrowserWindow): PartnerViewsHost`
  - IPC channels: `agentic:catalog`, `agentic:open-view`, `agentic:set-view-bounds`, `agentic:hide-view`, `agentic:view-command`; event `agentic:view-state`.

- [ ] **Step 1: Write the failing PartnerViews tests**

`src/main/agentic/PartnerViews.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { PartnerServiceKey, PartnerViewState } from '../../shared/agentic'
import { PartnerViews, type PartnerViewHandle } from './PartnerViews'

function setup(account: string | null = 'acct1') {
  const views: Array<{ service: PartnerServiceKey; partition: string; handle: PartnerViewHandle & { url: string; visible: boolean }; status: (s: PartnerViewState, back: boolean) => void }> = []
  const host = {
    createView: vi.fn((service: PartnerServiceKey, partition: string, onStatus: (s: PartnerViewState, back: boolean) => void) => {
      const handle = {
        url: '',
        visible: false,
        load: vi.fn((url: string) => { handle.url = url }),
        setBounds: vi.fn(),
        setVisible: vi.fn((visible: boolean) => { handle.visible = visible }),
        goBack: vi.fn(),
        currentUrl: () => handle.url,
        destroy: vi.fn(),
      }
      views.push({ service, partition, handle, status: onStatus })
      return handle
    }),
    openExternal: vi.fn(),
    contentSize: () => ({ width: 1000, height: 700 }),
  }
  let key = account
  const emit = vi.fn()
  const manager = new PartnerViews({ host, accountKey: async () => key, emit })
  return { manager, host, views, emit, signInAs: (next: string | null) => { key = next } }
}

describe('PartnerViews', () => {
  it('creates a view on first open at the start page in the account partition', async () => {
    const { manager, views } = setup()
    await manager.open('ubercare')
    expect(views).toHaveLength(1)
    expect(views[0]!.partition).toBe('persist:agentic-ubercare-acct1')
    expect(views[0]!.handle.url).toBe('https://remotecarers.net/worker/')
    expect(views[0]!.handle.visible).toBe(true)
  })

  it('keeps the current page when shown again, and loads a template when asked', async () => {
    const { manager, views } = setup()
    await manager.open('guardian-angel')
    views[0]!.handle.url = 'https://kin-keepers.ai/dashboard'
    await manager.open('guardian-angel')
    expect(views[0]!.handle.url).toBe('https://kin-keepers.ai/dashboard')
    await manager.open('guardian-angel', { kind: 'template', templateId: '7' })
    expect(views[0]!.handle.url).toBe('https://kin-keepers.ai/templates/7')
  })

  it('shows one view at a time', async () => {
    const { manager, views } = setup()
    await manager.open('ubercare')
    await manager.open('marketplace')
    expect(views.map((view) => view.handle.visible)).toEqual([false, true])
  })

  it('refuses to open without a signed-in account', async () => {
    const { manager, host } = setup(null)
    await expect(manager.open('ubercare')).rejects.toThrow()
    expect(host.createView).not.toHaveBeenCalled()
  })

  it('drops the previous account views when someone else signs in', async () => {
    const { manager, views, signInAs } = setup()
    await manager.open('ubercare')
    signInAs('acct2')
    await manager.open('ubercare')
    expect(views[0]!.handle.destroy).toHaveBeenCalled()
    expect(views[1]!.partition).toBe('persist:agentic-ubercare-acct2')
  })

  it('clamps bounds and ignores unopened services', async () => {
    const { manager, views } = setup()
    manager.setBounds('ubercare', { x: 0, y: 0, width: 10, height: 10 })
    await manager.open('ubercare')
    manager.setBounds('ubercare', { x: 100, y: 50, width: 5000, height: 5000 })
    expect(views[0]!.handle.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 50, width: 900, height: 650 })
    expect(() => manager.setBounds('ubercare', { x: 'x' })).toThrow()
  })

  it('runs back, reload and open-in-browser', async () => {
    const { manager, views, host } = setup()
    await manager.open('guardian-angel', { kind: 'template', templateId: '7' })
    manager.command('guardian-angel', 'back')
    expect(views[0]!.handle.goBack).toHaveBeenCalled()
    manager.command('guardian-angel', 'open-external')
    expect(host.openExternal).toHaveBeenCalledWith('https://kin-keepers.ai/templates/7')
    views[0]!.handle.url = 'chrome-error://chromewebdata/'
    manager.command('guardian-angel', 'reload')
    expect(views[0]!.handle.url).toBe('https://kin-keepers.ai/templates/7')
  })

  it('passes view status to the screen', async () => {
    const { manager, views, emit } = setup()
    await manager.open('marketplace')
    views[0]!.status('failed', false)
    expect(emit).toHaveBeenCalledWith({ service: 'marketplace', state: 'failed', canGoBack: false })
  })

  it('hides and destroys views', async () => {
    const { manager, views } = setup()
    await manager.open('ubercare')
    manager.hide('ubercare')
    expect(views[0]!.handle.visible).toBe(false)
    manager.destroyAll()
    expect(views[0]!.handle.destroy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `$N node_modules/vitest/vitest.mjs run src/main/agentic/PartnerViews.test.ts`
Expected: FAIL, cannot resolve `./PartnerViews`.

- [ ] **Step 3: Implement PartnerViews**

`src/main/agentic/PartnerViews.ts`:

```ts
import type {
  PartnerServiceKey,
  PartnerViewBounds,
  PartnerViewCommand,
  PartnerViewState,
  PartnerViewStatus,
  PartnerViewTarget,
} from '../../shared/agentic'
import { clampBounds, decideNavigation, partitionFor, PARTNER_SERVICES, targetUrl } from './partnerServices'

export interface PartnerViewHandle {
  load(url: string): void
  setBounds(bounds: PartnerViewBounds): void
  setVisible(visible: boolean): void
  goBack(): void
  currentUrl(): string
  destroy(): void
}

export interface PartnerViewsHost {
  createView(
    service: PartnerServiceKey,
    partition: string,
    onStatus: (state: PartnerViewState, canGoBack: boolean) => void,
  ): PartnerViewHandle
  openExternal(url: string): void
  contentSize(): { width: number; height: number }
}

interface OpenView { handle: PartnerViewHandle; requestedUrl: string }

/** One isolated partner web view per service, for the signed-in Family Circle account. */
export class PartnerViews {
  private readonly views = new Map<PartnerServiceKey, OpenView>()
  private account: string | null = null

  constructor(private readonly deps: {
    host: PartnerViewsHost
    accountKey(): Promise<string | null>
    emit(status: PartnerViewStatus): void
  }) {}

  async open(service: PartnerServiceKey, target?: PartnerViewTarget): Promise<void> {
    const account = await this.deps.accountKey()
    if (!account) throw new Error('Sign in to Family Circle first')
    if (account !== this.account) {
      this.destroyAll()
      this.account = account
    }
    let view = this.views.get(service)
    if (!view) {
      const handle = this.deps.host.createView(service, partitionFor(service, account), (state, canGoBack) => {
        this.deps.emit({ service, state, canGoBack })
      })
      view = { handle, requestedUrl: '' }
      this.views.set(service, view)
      target ??= { kind: 'start' }
    }
    if (target) {
      view.requestedUrl = targetUrl(service, target)
      view.handle.load(view.requestedUrl)
    }
    for (const [key, other] of this.views) other.handle.setVisible(key === service)
  }

  setBounds(service: PartnerServiceKey, bounds: unknown): void {
    const clamped = clampBounds(bounds, this.deps.host.contentSize())
    this.views.get(service)?.handle.setBounds(clamped)
  }

  hide(service: PartnerServiceKey): void {
    this.views.get(service)?.handle.setVisible(false)
  }

  command(service: PartnerServiceKey, command: PartnerViewCommand): void {
    const view = this.views.get(service)
    if (!view) return
    const current = view.handle.currentUrl()
    const page = decideNavigation(service, current) === 'allow' ? current : view.requestedUrl || PARTNER_SERVICES[service].startUrl
    if (command === 'back') view.handle.goBack()
    else if (command === 'reload') view.handle.load(page)
    else this.deps.host.openExternal(page)
  }

  destroyAll(): void {
    for (const view of this.views.values()) view.handle.destroy()
    this.views.clear()
  }
}
```

- [ ] **Step 4: Run to see it pass**

Run: `$N node_modules/vitest/vitest.mjs run src/main/agentic/PartnerViews.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing IPC tests**

`src/main/agentic/agenticIpc.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { registerAgenticIpc } from './agenticIpc'

function register() {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()
  const catalog = { get: vi.fn(async () => ({ status: 'unavailable' as const })) }
  const views = { open: vi.fn(async () => undefined), setBounds: vi.fn(), hide: vi.fn(), command: vi.fn() }
  registerAgenticIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, { catalog, views })
  const call = (channel: string, payload?: unknown) => Promise.resolve().then(() => handlers.get(channel)!({}, payload))
  return { call, catalog, views }
}

describe('agentic IPC', () => {
  it('passes refresh to the catalog', async () => {
    const { call, catalog } = register()
    await call('agentic:catalog', { refresh: true })
    expect(catalog.get).toHaveBeenCalledWith({ refresh: true })
    await call('agentic:catalog')
    expect(catalog.get).toHaveBeenLastCalledWith({ refresh: false })
  })

  it('opens views by service key and validated target only', async () => {
    const { call, views } = register()
    await expect(call('agentic:open-view', { service: 'guardian-angel', target: { kind: 'template', templateId: '7' } })).resolves.toEqual({ success: true })
    expect(views.open).toHaveBeenCalledWith('guardian-angel', { kind: 'template', templateId: '7' })
    await call('agentic:open-view', { service: 'ubercare' })
    expect(views.open).toHaveBeenLastCalledWith('ubercare', undefined)
    await expect(call('agentic:open-view', { service: 'https://evil.test' })).rejects.toThrow()
    await expect(call('agentic:open-view', { service: 'guardian-angel', target: { kind: 'template', templateId: '1/../x' } })).rejects.toThrow()
    await expect(call('agentic:open-view', { service: 'guardian-angel', target: { kind: 'url', url: 'https://evil.test' } })).rejects.toThrow()
    expect(views.open).toHaveBeenCalledTimes(2)
  })

  it('validates bounds, hide and commands', async () => {
    const { call, views } = register()
    await call('agentic:set-view-bounds', { service: 'ubercare', x: 1, y: 2, width: 3, height: 4 })
    expect(views.setBounds).toHaveBeenCalledWith('ubercare', { x: 1, y: 2, width: 3, height: 4 })
    await call('agentic:hide-view', { service: 'marketplace' })
    expect(views.hide).toHaveBeenCalledWith('marketplace')
    await call('agentic:view-command', { service: 'ubercare', command: 'reload' })
    expect(views.command).toHaveBeenCalledWith('ubercare', 'reload')
    await expect(call('agentic:view-command', { service: 'ubercare', command: 'eval' })).rejects.toThrow()
    await expect(call('agentic:hide-view', {})).rejects.toThrow()
  })
})
```

- [ ] **Step 6: Run to see it fail**

Run: `$N node_modules/vitest/vitest.mjs run src/main/agentic/agenticIpc.test.ts`
Expected: FAIL, cannot resolve `./agenticIpc`.

- [ ] **Step 7: Implement the IPC**

`src/main/agentic/agenticIpc.ts`:

```ts
import {
  isPartnerServiceKey,
  publicTemplate,
  TEMPLATE_ID,
  type GuardianAngelCatalogResult,
  type PartnerServiceKey,
  type PartnerViewCommand,
  type PartnerViewTarget,
} from '../../shared/agentic'
import type { IpcHandleRegistrar } from '../auth/authIpc'
import type { PartnerViews } from './PartnerViews'

export interface AgenticIpcDeps {
  catalog: { get(options?: { refresh?: boolean }): Promise<GuardianAngelCatalogResult> }
  views: Pick<PartnerViews, 'open' | 'setBounds' | 'hide' | 'command'>
}

function recordOf(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function serviceOf(payload: unknown): PartnerServiceKey {
  const service = recordOf(payload).service
  if (!isPartnerServiceKey(service)) throw new Error('Unknown partner service')
  return service
}

function targetOf(value: unknown): PartnerViewTarget | undefined {
  if (value === undefined) return undefined
  const raw = recordOf(value)
  if (raw.kind === 'start' || raw.kind === 'care-builder') return { kind: raw.kind }
  if (raw.kind === 'template' && typeof raw.templateId === 'string' && TEMPLATE_ID.test(raw.templateId)) {
    return { kind: 'template', templateId: raw.templateId }
  }
  throw new Error('Invalid partner page')
}

const COMMANDS = new Set<PartnerViewCommand>(['back', 'reload', 'open-external'])

export function registerAgenticIpc(ipc: IpcHandleRegistrar, deps: AgenticIpcDeps): void {
  ipc.handle('agentic:catalog', async (_event, payload) => {
    const result = await deps.catalog.get({ refresh: recordOf(payload).refresh === true })
    return result.status === 'ready' ? { ...result, templates: result.templates.map(publicTemplate) } : result
  })
  ipc.handle('agentic:open-view', async (_event, payload) => {
    const service = serviceOf(payload)
    await deps.views.open(service, targetOf(recordOf(payload).target))
    return { success: true }
  })
  ipc.handle('agentic:set-view-bounds', (_event, payload) => {
    const raw = recordOf(payload)
    deps.views.setBounds(serviceOf(payload), { x: raw.x, y: raw.y, width: raw.width, height: raw.height })
    return { success: true }
  })
  ipc.handle('agentic:hide-view', (_event, payload) => {
    deps.views.hide(serviceOf(payload))
    return { success: true }
  })
  ipc.handle('agentic:view-command', (_event, payload) => {
    const command = recordOf(payload).command
    if (!COMMANDS.has(command as PartnerViewCommand)) throw new Error('Unknown command')
    deps.views.command(serviceOf(payload), command as PartnerViewCommand)
    return { success: true }
  })
}
```

Check: `IpcHandleRegistrar` in `src/main/auth/authIpc.ts` has the `handle(channel, listener)` signature used by `circleIpc`; if its listener type is narrower, match it exactly.

- [ ] **Step 8: Run to see it pass**

Run: `$N node_modules/vitest/vitest.mjs run src/main/agentic`
Expected: PASS (all agentic main tests).

- [ ] **Step 9: Write the Electron host**

`src/main/agentic/electronPartnerViewHost.ts` (thin; covered by the real-app check in Task 9):

```ts
import { type BrowserWindow, session, shell, WebContentsView } from 'electron'
import type { PartnerServiceKey } from '../../shared/agentic'
import { decideNavigation } from './partnerServices'
import type { PartnerViewsHost } from './PartnerViews'

const ABORTED = -3
const lockedPartitions = new Set<string>()

function lockDownSession(partition: string) {
  if (lockedPartitions.has(partition)) return
  lockedPartitions.add(partition)
  const ses = session.fromPartition(partition)
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())
}

function openHttpsExternally(url: string) {
  if (url.startsWith('https://')) void shell.openExternal(url)
}

export function createElectronPartnerViewHost(window: BrowserWindow): PartnerViewsHost {
  return {
    createView(service: PartnerServiceKey, partition, onStatus) {
      lockDownSession(partition)
      const view = new WebContentsView({
        webPreferences: {
          partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      })
      const contents = view.webContents
      const canGoBack = () => contents.navigationHistory.canGoBack()
      let failed = false

      const guard = (event: { preventDefault(): void }, url: string) => {
        const decision = decideNavigation(service, url)
        if (decision === 'allow') return
        event.preventDefault()
        if (decision === 'external') openHttpsExternally(url)
      }
      // Electron 44 passes the target on the event; the positional url argument is deprecated.
      contents.on('will-navigate', (event) => guard(event, event.url))
      contents.on('will-redirect', (event) => guard(event, event.url))
      contents.setWindowOpenHandler(({ url }) => {
        const decision = decideNavigation(service, url)
        if (decision === 'allow') void contents.loadURL(url)
        else if (decision === 'external') openHttpsExternally(url)
        return { action: 'deny' }
      })
      contents.on('did-start-loading', () => {
        failed = false
        onStatus('loading', canGoBack())
      })
      contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
        if (!isMainFrame || errorCode === ABORTED) return
        failed = true
        onStatus('failed', canGoBack())
      })
      contents.on('did-stop-loading', () => { if (!failed) onStatus('ready', canGoBack()) })
      contents.on('did-navigate-in-page', () => onStatus('ready', canGoBack()))
      contents.on('render-process-gone', () => onStatus('failed', false))

      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      view.setVisible(false)
      window.contentView.addChildView(view)

      return {
        load: (url) => { void contents.loadURL(url).catch(() => undefined) },
        setBounds: (bounds) => view.setBounds(bounds),
        setVisible: (visible) => view.setVisible(visible),
        goBack: () => { if (canGoBack()) contents.navigationHistory.goBack() },
        currentUrl: () => contents.getURL(),
        destroy: () => {
          window.contentView.removeChildView(view)
          contents.close()
        },
      }
    },
    openExternal: openHttpsExternally,
    contentSize() {
      const [width = 0, height = 0] = window.getContentSize()
      return { width, height }
    },
  }
}
```

- [ ] **Step 10: Wire into `src/main/main.ts`**

Add imports:

```ts
import { createHash } from 'node:crypto'
import { registerAgenticIpc } from './agentic/agenticIpc'
import { createElectronPartnerViewHost } from './agentic/electronPartnerViewHost'
import { GuardianAngelCatalog } from './agentic/GuardianAngelCatalog'
import { PartnerViews } from './agentic/PartnerViews'
```

Add a module variable next to `mainWindow`:

```ts
let partnerViews: PartnerViews | null = null
```

At the end of `registerDesktopIpc(services)` add:

```ts
  registerAgenticIpc(ipcMain, {
    catalog: new GuardianAngelCatalog({
      fetch: (input, init) => fetch(input, init),
      cachePath: join(app.getPath('userData'), 'agentic', 'catalog.json'),
    }),
    views: {
      open: async (service, target) => {
        if (!partnerViews) throw new Error('The Family Circle window is not ready')
        await partnerViews.open(service, target)
      },
      setBounds: (service, bounds) => partnerViews?.setBounds(service, bounds),
      hide: (service) => partnerViews?.hide(service),
      command: (service, command) => partnerViews?.command(service, command),
    },
  })
```

In `createMainWindow()`, after `setWindowOpenHandler`, add (needs `services.sessions`, so change the signature to `createMainWindow(sessions: SessionStore)` and pass `services.sessions` at both call sites; import `type SessionStore` is already imported as a value):

```ts
  const window = mainWindow
  partnerViews = new PartnerViews({
    host: createElectronPartnerViewHost(window),
    async accountKey() {
      const user = await sessions.restore()
      return user ? createHash('sha256').update(`agentic:${user.id}`).digest('hex').slice(0, 16) : null
    },
    emit(status) {
      if (!window.isDestroyed()) window.webContents.send('agentic:view-state', status)
    },
  })
```

and in the `closed` handler add `partnerViews?.destroyAll(); partnerViews = null` before `mainWindow = null`.

- [ ] **Step 11: Typecheck and test**

Run: `npm run -s typecheck && $N node_modules/vitest/vitest.mjs run src/main/agentic`
Expected: no type errors; tests PASS.

- [ ] **Step 12: Commit**

```bash
git add src/main/agentic src/main/main.ts
git commit -m "feat: isolated partner web views and agentic IPC"
```

---

### Task 5: Preload bridge, renderer client and boundary rule

**Files:**
- Modify: `src/shared/desktopApi.ts`, `src/preload/createDesktopApi.ts`, `src/preload/createDesktopApi.test.ts:86` (key list test, only if it asserts top-level keys), `scripts/verify-boundaries.mjs`, `src/renderer/app/services.tsx`
- Create: `src/preload/createDesktopApi.agentic.test.ts`, `src/renderer/services/agentic/AgenticClient.ts`, `src/renderer/services/agentic/DesktopAgenticClient.ts`, `src/renderer/test/fakeAgenticClient.ts`

**Interfaces:**
- Consumes: shared agentic types; IPC channels from Task 4.
- Produces:
  - `DesktopApi['agentic']`: `getCatalog(input?: { refresh?: boolean }): Promise<GuardianAngelCatalogResult>`, `openView(input: { service: PartnerServiceKey; target?: PartnerViewTarget }): Promise<{ success: true }>`, `setViewBounds(input: { service: PartnerServiceKey } & PartnerViewBounds): Promise<{ success: true }>`, `hideView(input: { service: PartnerServiceKey }): Promise<{ success: true }>`, `viewCommand(input: { service: PartnerServiceKey; command: PartnerViewCommand }): Promise<{ success: true }>`, `onViewState(listener: (status: PartnerViewStatus) => void): () => void`.
  - `interface AgenticClient { getCatalog(refresh?: boolean); openView(service, target?); setViewBounds(service, bounds); hideView(service); viewCommand(service, command); onViewState(listener) }` (all methods return `Promise<void>` except `getCatalog` → `Promise<GuardianAngelCatalogResult>` and `onViewState` → unsubscribe).
  - `AppServices.agentic?: AgenticClient`.
  - `fakeAgenticClient(overrides?)` returning `AgenticClient & { emitState(status: PartnerViewStatus): void }` with `vi.fn` methods.

- [ ] **Step 1: Write the failing preload test**

`src/preload/createDesktopApi.agentic.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './createDesktopApi'

const template = {
  id: '7', name: 'Elder Companion', description: 'Warm', category: 'elder_companion',
  trustBoundaries: ['No medical advice'], escalationTriggers: [], avatar: null,
}

describe('desktop agentic API', () => {
  it('passes only valid templates and drops extra fields', async () => {
    const invoke = vi.fn(async () => ({
      status: 'ready', fetchedAt: 5, stale: false,
      templates: [{ ...template, created_by: 'x@example.test' }, { ...template, id: '../x' }, { ...template, avatar: 'https://evil.test/a.png' }],
    }))
    const api = createDesktopApi(invoke)
    await expect(api.agentic.getCatalog({ refresh: true })).resolves.toEqual({ status: 'ready', fetchedAt: 5, stale: false, templates: [template] })
    expect(invoke).toHaveBeenCalledWith('agentic:catalog', { refresh: true })
  })

  it('maps anything else to unavailable', async () => {
    const api = createDesktopApi(vi.fn(async () => ({ status: 'weird' })))
    await expect(api.agentic.getCatalog()).resolves.toEqual({ status: 'unavailable' })
  })

  it('sends only the expected fields for views', async () => {
    const invoke = vi.fn(async () => ({ success: true }))
    const api = createDesktopApi(invoke)
    await api.agentic.openView({ service: 'guardian-angel', target: { kind: 'template', templateId: '7' }, url: 'https://evil.test' } as never)
    expect(invoke).toHaveBeenLastCalledWith('agentic:open-view', { service: 'guardian-angel', target: { kind: 'template', templateId: '7' } })
    await api.agentic.setViewBounds({ service: 'ubercare', x: 1, y: 2, width: 3, height: 4 })
    expect(invoke).toHaveBeenLastCalledWith('agentic:set-view-bounds', { service: 'ubercare', x: 1, y: 2, width: 3, height: 4 })
    await api.agentic.hideView({ service: 'ubercare' })
    expect(invoke).toHaveBeenLastCalledWith('agentic:hide-view', { service: 'ubercare' })
    await api.agentic.viewCommand({ service: 'ubercare', command: 'back' })
    expect(invoke).toHaveBeenLastCalledWith('agentic:view-command', { service: 'ubercare', command: 'back' })
  })

  it('passes view state events through a safe shape', () => {
    let deliver!: (payload: unknown) => void
    const subscribe = vi.fn((_channel: string, listener: (payload: unknown) => void) => { deliver = listener; return () => undefined })
    const api = createDesktopApi(vi.fn(), subscribe as never)
    const listener = vi.fn()
    api.agentic.onViewState(listener)
    expect(subscribe).toHaveBeenCalledWith('agentic:view-state', expect.any(Function))
    deliver({ service: 'ubercare', state: 'failed', canGoBack: 'yes', extra: 1 })
    deliver({ service: 'other', state: 'ready', canGoBack: true })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ service: 'ubercare', state: 'failed', canGoBack: false })
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `$N node_modules/vitest/vitest.mjs run src/preload/createDesktopApi.agentic.test.ts`
Expected: FAIL, `api.agentic` is undefined.

- [ ] **Step 3: Add the shared API type**

In `src/shared/desktopApi.ts`, add at the top:

```ts
import type {
  GuardianAngelCatalogResult,
  PartnerServiceKey,
  PartnerViewBounds,
  PartnerViewCommand,
  PartnerViewStatus,
  PartnerViewTarget,
} from './agentic'
```

and inside `interface DesktopApi` after `speech: SpeechDesktopApi`:

```ts
  /** Agentic Services: the public Guardian Angel catalog and isolated partner web views. */
  agentic: {
    getCatalog(input?: { refresh?: boolean }): Promise<GuardianAngelCatalogResult>
    openView(input: { service: PartnerServiceKey; target?: PartnerViewTarget }): Promise<{ success: true }>
    setViewBounds(input: { service: PartnerServiceKey } & PartnerViewBounds): Promise<{ success: true }>
    hideView(input: { service: PartnerServiceKey }): Promise<{ success: true }>
    viewCommand(input: { service: PartnerServiceKey; command: PartnerViewCommand }): Promise<{ success: true }>
    onViewState(listener: (status: PartnerViewStatus) => void): () => void
  }
```

- [ ] **Step 4: Implement the preload side**

In `src/preload/createDesktopApi.ts`:
- Add channels `'agentic:catalog' | 'agentic:open-view' | 'agentic:set-view-bounds' | 'agentic:hide-view' | 'agentic:view-command'` to `DesktopChannel`, and `'agentic:view-state'` to `DesktopEventChannel`.
- Import from `'../shared/agentic'`: `isGuardianAngelTemplate, isPartnerServiceKey, publicTemplate` and the types `GuardianAngelCatalogResult, PartnerViewStatus, PartnerViewTarget`.
- Add helpers above `createDesktopApi`:

```ts
function safeCatalog(value: unknown): GuardianAngelCatalogResult {
  const raw = recordOf(value)
  if (raw.status !== 'ready' || !Array.isArray(raw.templates) || typeof raw.fetchedAt !== 'number') return { status: 'unavailable' }
  return {
    status: 'ready',
    templates: raw.templates.filter(isGuardianAngelTemplate).map(publicTemplate),
    fetchedAt: raw.fetchedAt,
    stale: raw.stale === true,
  }
}

function safeViewTarget(value: PartnerViewTarget | undefined): PartnerViewTarget | undefined {
  if (!value) return undefined
  return value.kind === 'template' ? { kind: 'template', templateId: String(value.templateId) } : { kind: value.kind }
}

function safeViewStatus(value: unknown): PartnerViewStatus | null {
  const raw = recordOf(value)
  if (!isPartnerServiceKey(raw.service)) return null
  const state = raw.state === 'loading' || raw.state === 'ready' || raw.state === 'failed' ? raw.state : 'failed'
  return { service: raw.service, state, canGoBack: raw.canGoBack === true }
}
```

- Add after the `speech` block inside the returned object:

```ts
    agentic: {
      async getCatalog(input) {
        return safeCatalog(await invoke('agentic:catalog', { refresh: input?.refresh === true }))
      },
      async openView(input) {
        const target = safeViewTarget(input.target)
        await invoke('agentic:open-view', target ? { service: input.service, target } : { service: input.service })
        return { success: true as const }
      },
      async setViewBounds(input) {
        await invoke('agentic:set-view-bounds', { service: input.service, x: input.x, y: input.y, width: input.width, height: input.height })
        return { success: true as const }
      },
      async hideView(input) {
        await invoke('agentic:hide-view', { service: input.service })
        return { success: true as const }
      },
      async viewCommand(input) {
        await invoke('agentic:view-command', { service: input.service, command: input.command })
        return { success: true as const }
      },
      onViewState(listener) {
        return subscribe('agentic:view-state', (payload) => {
          const status = safeViewStatus(payload)
          if (status) listener(status)
        })
      },
    },
```

If `createDesktopApi.test.ts` asserts the list of top-level API keys, add `'agentic'` at the end of that list.

- [ ] **Step 5: Run to see it pass**

Run: `$N node_modules/vitest/vitest.mjs run src/preload`
Expected: PASS.

- [ ] **Step 6: Renderer client, fake and services**

`src/renderer/services/agentic/AgenticClient.ts`:

```ts
import type {
  GuardianAngelCatalogResult,
  PartnerServiceKey,
  PartnerViewBounds,
  PartnerViewCommand,
  PartnerViewStatus,
  PartnerViewTarget,
} from '../../../shared/agentic'

/** Agentic Services: the Guardian Angel catalog and isolated partner web views. */
export interface AgenticClient {
  getCatalog(refresh?: boolean): Promise<GuardianAngelCatalogResult>
  openView(service: PartnerServiceKey, target?: PartnerViewTarget): Promise<void>
  setViewBounds(service: PartnerServiceKey, bounds: PartnerViewBounds): Promise<void>
  hideView(service: PartnerServiceKey): Promise<void>
  viewCommand(service: PartnerServiceKey, command: PartnerViewCommand): Promise<void>
  onViewState(listener: (status: PartnerViewStatus) => void): () => void
}
```

`src/renderer/services/agentic/DesktopAgenticClient.ts`:

```ts
import type { DesktopApi } from '../../../shared/desktopApi'
import type { AgenticClient } from './AgenticClient'

type AgenticDesktopOperations = DesktopApi['agentic']

const defaultOperations: AgenticDesktopOperations = {
  getCatalog: (input) => window.familyCircle.agentic.getCatalog(input),
  openView: (input) => window.familyCircle.agentic.openView(input),
  setViewBounds: (input) => window.familyCircle.agentic.setViewBounds(input),
  hideView: (input) => window.familyCircle.agentic.hideView(input),
  viewCommand: (input) => window.familyCircle.agentic.viewCommand(input),
  onViewState: (listener) => window.familyCircle.agentic.onViewState(listener),
}

export class DesktopAgenticClient implements AgenticClient {
  private readonly operations: AgenticDesktopOperations

  constructor(operations: Partial<AgenticDesktopOperations> = {}) {
    this.operations = { ...defaultOperations, ...operations }
  }

  getCatalog(refresh = false) {
    return this.operations.getCatalog({ refresh })
  }

  async openView(...[service, target]: Parameters<AgenticClient['openView']>) {
    await this.operations.openView(target ? { service, target } : { service })
  }

  async setViewBounds(...[service, bounds]: Parameters<AgenticClient['setViewBounds']>) {
    await this.operations.setViewBounds({ service, ...bounds })
  }

  async hideView(service: Parameters<AgenticClient['hideView']>[0]) {
    await this.operations.hideView({ service })
  }

  async viewCommand(...[service, command]: Parameters<AgenticClient['viewCommand']>) {
    await this.operations.viewCommand({ service, command })
  }

  onViewState(listener: Parameters<AgenticClient['onViewState']>[0]) {
    return this.operations.onViewState(listener)
  }
}
```

`src/renderer/test/fakeAgenticClient.ts`:

```ts
import { vi } from 'vitest'
import type { GuardianAngelCatalogResult, PartnerViewStatus } from '../../shared/agentic'
import type { AgenticClient } from '../services/agentic/AgenticClient'

export const SAMPLE_CATALOG: GuardianAngelCatalogResult = {
  status: 'ready',
  fetchedAt: Date.UTC(2026, 9, 15, 9, 30),
  stale: false,
  templates: [
    { id: '7', name: 'Elder Companion', description: 'Warm, patient daily conversation', category: 'elder_companion', trustBoundaries: ['No medical advice'], escalationTriggers: ['Self harm mentions'], avatar: null },
    { id: '9', name: 'Weekly Family Update', description: 'A short note to the family each week', category: 'family_update', trustBoundaries: [], escalationTriggers: [], avatar: null },
    { id: '12', name: 'Pill Reminder', description: 'Reminds about medication times', category: 'medication_appointment', trustBoundaries: ['No dosage changes'], escalationTriggers: [], avatar: null },
  ],
}

export function fakeAgenticClient(overrides: Partial<AgenticClient> = {}) {
  const listeners = new Set<(status: PartnerViewStatus) => void>()
  const client = {
    getCatalog: vi.fn(async () => SAMPLE_CATALOG),
    openView: vi.fn(async () => undefined),
    setViewBounds: vi.fn(async () => undefined),
    hideView: vi.fn(async () => undefined),
    viewCommand: vi.fn(async () => undefined),
    onViewState: vi.fn((listener: (status: PartnerViewStatus) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }),
    ...overrides,
    emitState: (status: PartnerViewStatus) => listeners.forEach((listener) => listener(status)),
  }
  return client satisfies AgenticClient
}
```

`src/renderer/app/services.tsx`: add `import type { AgenticClient } from '../services/agentic/AgenticClient'` and `import { DesktopAgenticClient } from '../services/agentic/DesktopAgenticClient'`; add to `AppServices`:

```ts
  /** Agentic Services; without it, those pages explain they are unavailable. */
  agentic?: AgenticClient
```

and `agentic: new DesktopAgenticClient(),` to `defaultServices`.

- [ ] **Step 7: Boundary rule**

In `scripts/verify-boundaries.mjs` add `const desktopAgenticClientPath = 'src/renderer/services/agentic/DesktopAgenticClient.ts'` next to the other client paths, and after the speech block:

```js
  if (file !== desktopAgenticClientPath) {
    recordMatches(violations, file, content, [
      {
        name: 'production renderer must access Agentic Services preload only through DesktopAgenticClient',
        pattern: /window\.familyCircle\.agentic/g,
      },
    ])
  }
```

- [ ] **Step 8: Verify**

Run: `npm run -s typecheck && node scripts/verify-boundaries.mjs && $N node_modules/vitest/vitest.mjs run src/preload`
Expected: no errors; boundary check passes; tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/shared/desktopApi.ts src/preload src/renderer/services/agentic src/renderer/test/fakeAgenticClient.ts src/renderer/app/services.tsx scripts/verify-boundaries.mjs
git commit -m "feat: agentic bridge and renderer client"
```

---

### Task 6: COMMAND mode, sidebar group and routes

**Files:**
- Modify: `src/renderer/app/App.tsx`, `src/renderer/app/Sidebar.tsx`, `src/renderer/app/App.css`
- Create: `src/renderer/features/agentic/GuardianAngelPage.tsx` and `PartnerViewPage.tsx` as minimal placeholders (filled in Tasks 7 and 8)
- Test: `src/renderer/app/Sidebar.test.tsx`, `src/renderer/app/App.commandMode.test.tsx`

**Interfaces:**
- Consumes: `PartnerServiceKey`.
- Produces: `agenticNavigationItems: NavigationItem[]`; `isCommandPath(pathname: string): boolean` exported from `Sidebar.tsx`; routes `/agentic/guardian-angel` (→ `GuardianAngelPage`), `/agentic/guardian-angel/view` (→ `<PartnerViewPage service="guardian-angel" />`), `/agentic/ubercare` (→ `<PartnerViewPage service="ubercare" />`), `/agentic/marketplace` (→ `<PartnerViewPage service="marketplace" />`); `.app-shell[data-mode]` attribute (`'ask' | 'command'`).

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/app/Sidebar.test.tsx` (change `renderSidebar` to take a starting path: `function renderSidebar(getVersion = vi.fn(async () => '0.9.2'), path = '/')` and use `<MemoryRouter initialEntries={[path]}>`):

```tsx
  it('lists the Agentic Services', () => {
    renderSidebar()
    const group = screen.getByRole('navigation', { name: 'Agentic Services' })
    expect(within(group).getByRole('link', { name: 'Guardian Angel' })).toHaveAttribute('href', '/agentic/guardian-angel')
    expect(within(group).getByRole('link', { name: 'UberCare' })).toHaveAttribute('href', '/agentic/ubercare')
    expect(within(group).getByRole('link', { name: 'Marketplace' })).toHaveAttribute('href', '/agentic/marketplace')
  })

  it('shows Command mode on an agentic page', () => {
    renderSidebar(undefined, '/agentic/ubercare')
    expect(screen.getByLabelText('Current mode: Command mode')).toHaveTextContent('Command mode')
  })
```

(import `within` from `@testing-library/react`).

`src/renderer/app/App.commandMode.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockCircleClient } from '../services/circle/MockCircleClient'
import { fakeAgenticClient } from '../test/fakeAgenticClient'
import { AuthenticatedApp } from './App'
import { AppServicesProvider } from './services'

afterEach(() => { delete (window as { familyCircle?: unknown }).familyCircle })

function renderAt(path: string) {
  ;(window as { familyCircle?: unknown }).familyCircle = {
    privateAi: { getStatus: vi.fn(async () => ({ state: 'ready' })), onProgress: vi.fn(() => () => undefined) },
  }
  const user = { id: 1, email: 'a@example.test', name: 'Trevor', accountOrigin: 'local', mustChangePassword: false, onboardingCompleted: true } as never
  render(
    <AppServicesProvider services={{ circle: new MockCircleClient(), agentic: fakeAgenticClient() }}>
      <MemoryRouter initialEntries={[path]}>
        <AuthenticatedApp user={user} auth={{} as never} onSignOut={async () => undefined} />
      </MemoryRouter>
    </AppServicesProvider>,
  )
  return document.querySelector('.app-shell')
}

describe('COMMAND mode', () => {
  it('is green on agentic pages and blue elsewhere', () => {
    expect(renderAt('/agentic/guardian-angel')).toHaveAttribute('data-mode', 'command')
  })

  it('stays in Ask mode on core pages', () => {
    expect(renderAt('/vault')).toHaveAttribute('data-mode', 'ask')
  })
})
```

Check how `App.test.tsx` renders `AuthenticatedApp` (user shape, auth stub, window bridge stubs) and copy that setup if this one is missing something.

- [ ] **Step 2: Run to see them fail**

Run: `$N node_modules/vitest/vitest.mjs run src/renderer/app/Sidebar.test.tsx src/renderer/app/App.commandMode.test.tsx`
Expected: FAIL (no Agentic Services navigation, no `data-mode`).

- [ ] **Step 3: Implement the sidebar**

In `src/renderer/app/Sidebar.tsx`:
- Add `HeartHandshake, ShieldCheck, Store` to the lucide import and `useLocation` to the react-router import.
- Below `navigationItems`:

```tsx
export const agenticNavigationItems: NavigationItem[] = [
  { label: 'Guardian Angel', to: '/agentic/guardian-angel', icon: ShieldCheck },
  { label: 'UberCare', to: '/agentic/ubercare', icon: HeartHandshake },
  { label: 'Marketplace', to: '/agentic/marketplace', icon: Store },
]

/** Agentic Services run in COMMAND mode (green); everything else is Ask mode (blue). */
export function isCommandPath(pathname: string): boolean {
  return pathname === '/agentic' || pathname.startsWith('/agentic/')
}

function SidebarLink({ label, to, icon: Icon }: NavigationItem) {
  return (
    <NavLink
      end={to === '/'}
      to={to}
      aria-label={label}
      className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link--active' : ''}`}
    >
      <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  )
}
```

- In `Sidebar`, add `const commandMode = isCommandPath(useLocation().pathname)` and `const modeLabel = commandMode ? 'Command mode' : 'Ask mode'`.
- Replace the mode pill and its comment with:

```tsx
        {/* Ask mode is the blue family workspace; Agentic Services switch to green Command mode. */}
        <span className="app-sidebar__mode" aria-label={`Current mode: ${modeLabel}`}>{modeLabel}</span>
```

- Replace the `<nav>` with a scroll area holding both groups (the existing `.app-sidebar__nav` styles keep scrolling in short windows):

```tsx
      <div className="app-sidebar__nav">
        <nav className="app-sidebar__group" aria-label="Primary navigation">
          {navigationItems.map((item) => <SidebarLink key={item.to} {...item} />)}
        </nav>
        <nav className="app-sidebar__group" aria-labelledby="agentic-services-heading">
          <h2 id="agentic-services-heading" className="app-sidebar__group-title">Agentic Services</h2>
          {agenticNavigationItems.map((item) => <SidebarLink key={item.to} {...item} />)}
        </nav>
      </div>
```

- [ ] **Step 4: Routes and mode attribute**

In `src/renderer/app/App.tsx`:
- Import `useLocation` from `react-router-dom`, `isCommandPath` from `./Sidebar`, `GuardianAngelPage` from `'../features/agentic/GuardianAngelPage'`, `PartnerViewPage` from `'../features/agentic/PartnerViewPage'`.
- In the component: `const commandMode = isCommandPath(useLocation().pathname)`.
- `<div className="app-shell" data-mode={commandMode ? 'command' : 'ask'}>`.
- Add routes before the `*` route:

```tsx
            <Route path="/agentic/guardian-angel" element={<GuardianAngelPage />} />
            <Route path="/agentic/guardian-angel/view" element={<PartnerViewPage key="guardian-angel" service="guardian-angel" />} />
            <Route path="/agentic/ubercare" element={<PartnerViewPage key="ubercare" service="ubercare" />} />
            <Route path="/agentic/marketplace" element={<PartnerViewPage key="marketplace" service="marketplace" />} />
```

Placeholder pages for now (replaced in Tasks 7 and 8):

`src/renderer/features/agentic/GuardianAngelPage.tsx`:

```tsx
export function GuardianAngelPage() {
  return <section className="agentic-page"><h1>Guardian Angel</h1></section>
}
```

`src/renderer/features/agentic/PartnerViewPage.tsx`:

```tsx
import type { PartnerServiceKey } from '../../../shared/agentic'

export function PartnerViewPage({ service }: { service: PartnerServiceKey }) {
  return <section className="agentic-page" data-service={service} />
}
```

- [ ] **Step 5: Green tokens and sidebar styles**

Append to `src/renderer/app/App.css` (before the `@media (max-height: 760px)` block):

```css
/*
 * COMMAND mode (Agentic Services): the same role tokens in green. White text on
 * #15803d is 5.0:1 and on #166534 7.1:1 (WCAG AA). --kk-focus is computed where
 * it is declared, so it is restated here.
 */
.app-shell[data-mode='command'] {
  --kk-accent: #15803d;
  --kk-accent-rgb: 21 128 61;
  --kk-accent-dark: #166534;
  --kk-accent-dark-rgb: 22 101 52;
  --kk-accent-bright: #22c55e;
  --kk-accent-light: #86efac;
  --kk-accent-light-rgb: 134 239 172;
  --kk-accent-soft: #eaf7ee;
  --kk-accent-soft-rgb: 234 247 238;
  --kk-accent-ring: #bfe5cb;
  --kk-focus: 0 0 0 3px rgb(21 128 61 / 0.3);
}

.app-shell[data-mode='command'] .app-sidebar {
  background:
    radial-gradient(circle at 0 0, rgb(var(--kk-accent-rgb) / 0.22), transparent 32%),
    linear-gradient(180deg, #0f3d2c 0%, #0a2d20 100%);
}

.app-sidebar__group {
  display: flex;
  flex-direction: column;
  gap: inherit;
}

.app-sidebar__group + .app-sidebar__group {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
}

.app-sidebar__group-title {
  margin: 0 0 4px;
  padding: 0 12px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
```

and inside `@media (max-height: 760px)`:

```css
  .app-sidebar__group + .app-sidebar__group {
    margin-top: 8px;
    padding-top: 8px;
  }
```

Check that `.app-sidebar__nav` uses `gap`, so `gap: inherit` on groups keeps link spacing; if `.app-sidebar__nav` children were the links directly, nothing else needs to change.

- [ ] **Step 6: Run to see them pass**

Run: `$N node_modules/vitest/vitest.mjs run src/renderer/app`
Expected: PASS (existing Sidebar/App tests still pass; if an existing test queries `getByRole('navigation', { name: 'Primary navigation' })` and expects all links inside it, it still passes because core links stay in that nav).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/app src/renderer/features/agentic
git commit -m "feat: green COMMAND mode and Agentic Services in the sidebar"
```

---

### Task 7: Guardian Angel catalog page

**Files:**
- Modify: `src/renderer/features/agentic/GuardianAngelPage.tsx`
- Create: `src/renderer/features/agentic/agentic.css`
- Test: `src/renderer/features/agentic/GuardianAngelPage.test.tsx`

**Interfaces:**
- Consumes: `useAppServices().agentic`, `GUARDIAN_ANGEL_CATEGORIES`, `SAMPLE_CATALOG`, `fakeAgenticClient`.
- Produces: navigation to `/agentic/guardian-angel/view?template={id}`, `/agentic/guardian-angel/view` (sign in), `/agentic/guardian-angel/view?page=care-builder`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/features/agentic/GuardianAngelPage.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppServicesProvider } from '../../app/services'
import type { AgenticClient } from '../../services/agentic/AgenticClient'
import { MockCircleClient } from '../../services/circle/MockCircleClient'
import { fakeAgenticClient, SAMPLE_CATALOG } from '../../test/fakeAgenticClient'
import { GuardianAngelPage } from './GuardianAngelPage'

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function renderPage(agentic: AgenticClient | undefined = fakeAgenticClient()) {
  render(
    <AppServicesProvider services={{ circle: new MockCircleClient(), agentic }}>
      <MemoryRouter initialEntries={['/agentic/guardian-angel']}>
        <Routes>
          <Route path="/agentic/guardian-angel" element={<GuardianAngelPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </AppServicesProvider>,
  )
  return agentic
}

describe('GuardianAngelPage', () => {
  it('groups templates by category with their safety rules', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Elder companion' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Medication and appointments' })).toBeInTheDocument()
    const card = screen.getByRole('article', { name: 'Elder Companion' })
    expect(within(card).getByText('No medical advice')).toBeInTheDocument()
    expect(within(card).getByText('Self harm mentions')).toBeInTheDocument()
    expect(screen.getByText(/Family Circle shares nothing/)).toBeInTheDocument()
  })

  it('opens a template in the secure view', async () => {
    renderPage()
    const card = await screen.findByRole('article', { name: 'Elder Companion' })
    fireEvent.click(within(card).getByRole('button', { name: 'Use this template' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/agentic/guardian-angel/view?template=7')
  })

  it('offers sign in and Care Builder', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Care Builder' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/agentic/guardian-angel/view?page=care-builder')
  })

  it('filters by search and says when nothing matches', async () => {
    renderPage()
    await screen.findByRole('article', { name: 'Elder Companion' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search templates' }), { target: { value: 'pill' } })
    expect(screen.getByRole('article', { name: 'Pill Reminder' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Elder Companion' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search templates' }), { target: { value: 'zzz' } })
    expect(screen.getByText('No templates match “zzz”.')).toBeInTheDocument()
  })

  it('shows the saved copy when offline and retries', async () => {
    const getCatalog = vi.fn()
      .mockResolvedValueOnce({ ...SAMPLE_CATALOG, stale: true })
      .mockResolvedValueOnce(SAMPLE_CATALOG)
    renderPage(fakeAgenticClient({ getCatalog }))
    expect(await screen.findByText(/Showing the copy from/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByText(/Showing the copy from/)).not.toBeInTheDocument())
    expect(getCatalog).toHaveBeenLastCalledWith(true)
  })

  it('explains when the catalog cannot be reached', async () => {
    renderPage(fakeAgenticClient({ getCatalog: vi.fn(async () => ({ status: 'unavailable' as const })) }))
    expect(await screen.findByText("Couldn't reach Guardian Angel")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('treats a failed request like an unreachable catalog', async () => {
    renderPage(fakeAgenticClient({ getCatalog: vi.fn(async () => { throw new Error('ipc') }) }))
    expect(await screen.findByText("Couldn't reach Guardian Angel")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `$N node_modules/vitest/vitest.mjs run src/renderer/features/agentic/GuardianAngelPage.test.tsx`
Expected: FAIL (placeholder page).

- [ ] **Step 3: Implement the page**

`src/renderer/features/agentic/GuardianAngelPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LogIn, RefreshCw, Search, ShieldCheck, Wrench } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { GUARDIAN_ANGEL_CATEGORIES, type GuardianAngelCatalogResult, type GuardianAngelTemplate } from '../../../shared/agentic'
import { useAppServices } from '../../app/services'
import './agentic.css'

type LoadState = { status: 'loading' } | GuardianAngelCatalogResult

const VIEW = '/agentic/guardian-angel/view'

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join('')
}

function savedOn(time: number): string {
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function TemplateCard({ template, onUse }: { template: GuardianAngelTemplate; onUse(): void }) {
  const headingId = `ga-template-${template.id}`
  const rules = template.trustBoundaries.length + template.escalationTriggers.length
  return (
    <article className="ga-card" aria-labelledby={headingId}>
      <div className="ga-card__top">
        {template.avatar
          ? <img className="ga-card__avatar" src={template.avatar} alt="" draggable={false} />
          : <span className="ga-card__avatar" aria-hidden="true">{initials(template.name)}</span>}
        <h3 id={headingId}>{template.name}</h3>
      </div>
      {template.description ? <p className="ga-card__description">{template.description}</p> : null}
      {rules > 0 ? (
        <details className="ga-card__rules">
          <summary><ShieldCheck size={15} aria-hidden="true" /> Safety rules ({rules})</summary>
          {template.trustBoundaries.length > 0 ? (
            <>
              <h4>Stays within</h4>
              <ul>{template.trustBoundaries.map((rule) => <li key={rule}>{rule}</li>)}</ul>
            </>
          ) : null}
          {template.escalationTriggers.length > 0 ? (
            <>
              <h4>Alerts the family about</h4>
              <ul>{template.escalationTriggers.map((rule) => <li key={rule}>{rule}</li>)}</ul>
            </>
          ) : null}
        </details>
      ) : null}
      <button type="button" className="primary-action ga-card__use" onClick={onUse}>Use this template</button>
    </article>
  )
}

/** The public Guardian Angel templates, shown natively; people activate them on Kin-Keepers.ai. */
export function GuardianAngelPage() {
  const { agentic } = useAppServices()
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')

  const load = useCallback(async (refresh: boolean) => {
    if (!agentic) {
      setState({ status: 'unavailable' })
      return
    }
    try {
      setState(await agentic.getCatalog(refresh))
    } catch {
      setState({ status: 'unavailable' })
    }
  }, [agentic])

  useEffect(() => { void load(false) }, [load])

  const groups = useMemo(() => {
    if (state.status !== 'ready') return []
    const needle = query.trim().toLowerCase()
    const matches = state.templates.filter((template) => (
      !needle || `${template.name} ${template.description}`.toLowerCase().includes(needle)
    ))
    return GUARDIAN_ANGEL_CATEGORIES
      .map((category) => ({ ...category, templates: matches.filter((template) => template.category === category.key) }))
      .filter((group) => group.templates.length > 0)
  }, [state, query])

  return (
    <section className="agentic-page ga-page" aria-labelledby="ga-heading">
      <header className="ga-page__header">
        <div>
          <h1 id="ga-heading">Guardian Angel</h1>
          <p>Ready-made care helpers from Kin-Keepers.ai. Choose one, then set it up on Kin-Keepers.ai. Family Circle shares nothing with it.</p>
        </div>
        <div className="ga-page__actions">
          <button type="button" className="secondary-action" onClick={() => navigate(VIEW)}>
            <LogIn size={16} aria-hidden="true" /> Sign in to Kin-Keepers.ai
          </button>
          <button type="button" className="secondary-action" onClick={() => navigate(`${VIEW}?page=care-builder`)}>
            <Wrench size={16} aria-hidden="true" /> Care Builder
          </button>
        </div>
      </header>

      {state.status === 'loading' ? <p className="ga-page__note" role="status">Loading templates…</p> : null}

      {state.status === 'unavailable' ? (
        <div className="ga-page__problem" role="alert">
          <strong>Couldn't reach Guardian Angel</strong>
          <span>Check your internet connection and try again.</span>
          <button type="button" className="secondary-action" onClick={() => void load(true)}>
            <RefreshCw size={16} aria-hidden="true" /> Retry
          </button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          {state.stale ? (
            <div className="ga-page__stale" role="status">
              <span>Showing the copy from {savedOn(state.fetchedAt)}. Couldn't reach Guardian Angel just now.</span>
              <button type="button" className="secondary-action" onClick={() => void load(true)}>
                <RefreshCw size={16} aria-hidden="true" /> Retry
              </button>
            </div>
          ) : null}
          <label className="ga-page__search">
            <Search size={16} aria-hidden="true" />
            <input type="search" aria-label="Search templates" placeholder="Search templates" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {groups.length === 0 ? <p className="ga-page__note">No templates match “{query.trim()}”.</p> : null}
          {groups.map((group) => (
            <section key={group.key} className="ga-group" aria-labelledby={`ga-group-${group.key}`}>
              <h2 id={`ga-group-${group.key}`}>{group.label}</h2>
              <div className="ga-grid">
                {group.templates.map((template) => (
                  <TemplateCard key={template.id} template={template} onUse={() => navigate(`${VIEW}?template=${encodeURIComponent(template.id)}`)} />
                ))}
              </div>
            </section>
          ))}
        </>
      ) : null}
    </section>
  )
}
```

Check `primary-action` / `secondary-action` exist as shared button classes (`grep -rn "\.secondary-action" src/renderer`); if `secondary-action` does not exist, use the class the Settings page uses for its secondary buttons.

- [ ] **Step 4: Styles**

`src/renderer/features/agentic/agentic.css`:

```css
.agentic-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 28px 32px 40px;
}

.ga-page__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.ga-page__header h1 {
  margin: 0 0 6px;
  color: var(--kk-text);
  font-size: 26px;
}

.ga-page__header p {
  max-width: 640px;
  margin: 0;
  color: var(--kk-text-muted);
  font-size: 14px;
  line-height: 1.55;
}

.ga-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.ga-page__search {
  display: flex;
  max-width: 420px;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--kk-border);
  border-radius: var(--kk-radius-sm);
  color: var(--kk-text-muted);
  background: var(--kk-card);
}

.ga-page__search:focus-within {
  box-shadow: var(--kk-focus);
}

.ga-page__search input {
  flex: 1;
  min-height: 40px;
  border: 0;
  outline: none;
  color: var(--kk-text);
  background: transparent;
  font: inherit;
  font-size: 14px;
}

.ga-page__note {
  margin: 0;
  color: var(--kk-text-muted);
  font-size: 14px;
}

.ga-page__problem,
.ga-page__stale {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  padding: 14px 16px;
  border: 1px solid var(--kk-accent-ring);
  border-radius: var(--kk-radius-md);
  color: var(--kk-text);
  background: var(--kk-accent-soft);
  font-size: 14px;
}

.ga-group h2 {
  margin: 8px 0 12px;
  color: var(--kk-text);
  font-size: 17px;
}

.ga-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}

.ga-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--kk-border);
  border-radius: var(--kk-radius-md);
  background: var(--kk-card);
  box-shadow: var(--kk-shadow-card);
}

.ga-card__top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ga-card__top h3 {
  margin: 0;
  color: var(--kk-text);
  font-size: 15px;
}

.ga-card__avatar {
  display: grid;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 12px;
  color: var(--kk-accent-dark);
  background: var(--kk-accent-soft);
  font-size: 14px;
  font-weight: 800;
  object-fit: cover;
}

.ga-card__description {
  margin: 0;
  color: var(--kk-text-muted);
  font-size: 13.5px;
  line-height: 1.5;
}

.ga-card__rules {
  color: var(--kk-text);
  font-size: 13px;
}

.ga-card__rules summary {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--kk-accent-dark);
  font-weight: 700;
  cursor: pointer;
}

.ga-card__rules h4 {
  margin: 10px 0 4px;
  font-size: 13px;
}

.ga-card__rules ul {
  margin: 0;
  padding-left: 18px;
  line-height: 1.5;
}

.ga-card__use {
  align-self: flex-start;
  margin-top: auto;
}
```

- [ ] **Step 5: Run to see it pass**

Run: `$N node_modules/vitest/vitest.mjs run src/renderer/features/agentic/GuardianAngelPage.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/features/agentic
git commit -m "feat: Guardian Angel template catalog page"
```

---

### Task 8: Partner view page

**Files:**
- Modify: `src/renderer/features/agentic/PartnerViewPage.tsx`, `src/renderer/features/agentic/agentic.css`
- Create: `src/renderer/features/agentic/useOverlayOpen.ts`
- Test: `src/renderer/features/agentic/PartnerViewPage.test.tsx`

**Interfaces:**
- Consumes: `useAppServices().agentic`, `PartnerServiceKey`, `PartnerViewTarget`, `fakeAgenticClient`.
- Produces: `useOverlayOpen(): boolean` (true while any `[role="menu"]` or `[role="dialog"]` is in the document).

- [ ] **Step 1: Write the failing tests**

`src/renderer/features/agentic/PartnerViewPage.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppServicesProvider } from '../../app/services'
import { MockCircleClient } from '../../services/circle/MockCircleClient'
import { fakeAgenticClient } from '../../test/fakeAgenticClient'
import { PartnerViewPage } from './PartnerViewPage'

function Leave() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate('/vault')}>Go to vault</button>
}

function renderView(path: string, service: 'guardian-angel' | 'ubercare' | 'marketplace') {
  const agentic = fakeAgenticClient()
  const route = path.split('?')[0]!
  render(
    <AppServicesProvider services={{ circle: new MockCircleClient(), agentic }}>
      <MemoryRouter initialEntries={[path]}>
        <Leave />
        <Routes>
          <Route path={route} element={<PartnerViewPage service={service} />} />
          <Route path="/vault" element={<p>Vault page</p>} />
        </Routes>
      </MemoryRouter>
    </AppServicesProvider>,
  )
  return agentic
}

describe('PartnerViewPage', () => {
  it('opens the service, places the view and says nothing is shared', async () => {
    const agentic = renderView('/agentic/ubercare', 'ubercare')
    expect(screen.getByRole('heading', { name: 'UberCare' })).toBeInTheDocument()
    expect(screen.getByText('Partner service. Family Circle shares nothing with it.')).toBeInTheDocument()
    await waitFor(() => expect(agentic.openView).toHaveBeenCalledWith('ubercare', { kind: 'start' }))
    await waitFor(() => expect(agentic.setViewBounds).toHaveBeenCalledWith('ubercare', expect.objectContaining({ x: expect.any(Number) })))
  })

  it('opens a template or Care Builder from the address', async () => {
    const template = renderView('/agentic/guardian-angel/view?template=7', 'guardian-angel')
    await waitFor(() => expect(template.openView).toHaveBeenCalledWith('guardian-angel', { kind: 'template', templateId: '7' }))
  })

  it('opens Care Builder from the address', async () => {
    const builder = renderView('/agentic/guardian-angel/view?page=care-builder', 'guardian-angel')
    await waitFor(() => expect(builder.openView).toHaveBeenCalledWith('guardian-angel', { kind: 'care-builder' }))
    expect(screen.getByRole('link', { name: /All templates/ })).toHaveAttribute('href', '/agentic/guardian-angel')
  })

  it('runs the header commands', async () => {
    const agentic = renderView('/agentic/marketplace', 'marketplace')
    act(() => agentic.emitState({ service: 'marketplace', state: 'ready', canGoBack: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }))
    expect(agentic.viewCommand.mock.calls).toEqual([['marketplace', 'back'], ['marketplace', 'reload'], ['marketplace', 'open-external']])
  })

  it('shows a load failure over a hidden view and retries', async () => {
    const agentic = renderView('/agentic/ubercare', 'ubercare')
    await waitFor(() => expect(agentic.openView).toHaveBeenCalled())
    act(() => agentic.emitState({ service: 'ubercare', state: 'failed', canGoBack: false }))
    expect(screen.getByText("Couldn't open UberCare")).toBeInTheDocument()
    await waitFor(() => expect(agentic.hideView).toHaveBeenCalledWith('ubercare'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(agentic.viewCommand).toHaveBeenLastCalledWith('ubercare', 'reload')
  })

  it('ignores status from other services', async () => {
    const agentic = renderView('/agentic/ubercare', 'ubercare')
    act(() => agentic.emitState({ service: 'marketplace', state: 'failed', canGoBack: false }))
    expect(screen.queryByText(/Couldn't open/)).not.toBeInTheDocument()
  })

  it('hides the view while a menu is open and when leaving the page', async () => {
    const agentic = renderView('/agentic/ubercare', 'ubercare')
    await waitFor(() => expect(agentic.openView).toHaveBeenCalled())
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    act(() => { document.body.appendChild(menu) })
    await waitFor(() => expect(agentic.hideView).toHaveBeenCalledWith('ubercare'))
    agentic.openView.mockClear()
    act(() => { menu.remove() })
    await waitFor(() => expect(agentic.openView).toHaveBeenCalledWith('ubercare'))

    agentic.hideView.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Go to vault' }))
    expect(screen.getByText('Vault page')).toBeInTheDocument()
    expect(agentic.hideView).toHaveBeenCalledWith('ubercare')
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `$N node_modules/vitest/vitest.mjs run src/renderer/features/agentic/PartnerViewPage.test.tsx`
Expected: FAIL (placeholder page).

- [ ] **Step 3: Implement the overlay hook**

`src/renderer/features/agentic/useOverlayOpen.ts`:

```ts
import { useEffect, useState } from 'react'

const OVERLAY = '[role="menu"], [role="dialog"]'

/**
 * True while a menu or dialog is open anywhere in the app. Partner web views are drawn
 * above the page, so they hide while one is open.
 */
export function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(() => document.querySelector(OVERLAY) !== null)
  useEffect(() => {
    const check = () => setOpen(document.querySelector(OVERLAY) !== null)
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'] })
    check()
    return () => observer.disconnect()
  }, [])
  return open
}
```

- [ ] **Step 4: Implement the page**

`src/renderer/features/agentic/PartnerViewPage.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, LayoutGrid, RefreshCw } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import type { PartnerServiceKey, PartnerViewState, PartnerViewTarget } from '../../../shared/agentic'
import { useAppServices } from '../../app/services'
import { useOverlayOpen } from './useOverlayOpen'
import './agentic.css'

const SERVICE_NAMES: Record<PartnerServiceKey, string> = {
  'guardian-angel': 'Guardian Angel',
  ubercare: 'UberCare',
  marketplace: 'Marketplace',
}

function targetFrom(params: URLSearchParams): PartnerViewTarget {
  const template = params.get('template')
  if (template) return { kind: 'template', templateId: template }
  if (params.get('page') === 'care-builder') return { kind: 'care-builder' }
  return { kind: 'start' }
}

/** A partner website shown inside Family Circle in its own isolated, sandboxed view. */
export function PartnerViewPage({ service }: { service: PartnerServiceKey }) {
  const { agentic } = useAppServices()
  const [params] = useSearchParams()
  const target = useMemo(() => targetFrom(params), [params])
  const slotRef = useRef<HTMLDivElement | null>(null)
  const [opened, setOpened] = useState(false)
  const [state, setState] = useState<PartnerViewState>('loading')
  const [canGoBack, setCanGoBack] = useState(false)
  const overlayOpen = useOverlayOpen()
  const name = SERVICE_NAMES[service]
  const visible = opened && !overlayOpen && state !== 'failed'

  useEffect(() => {
    if (!agentic) return undefined
    return agentic.onViewState((status) => {
      if (status.service !== service) return
      setState(status.state)
      setCanGoBack(status.canGoBack)
    })
  }, [agentic, service])

  // Load the page asked for in the address (a template, Care Builder or the start page).
  useEffect(() => {
    if (!agentic) return
    let active = true
    setOpened(false)
    void agentic.openView(service, target)
      .then(() => { if (active) setOpened(true) })
      .catch(() => { if (active) setState('failed') })
    return () => { active = false }
  }, [agentic, service, target])

  // Show the view over its slot and keep it in place; hide it on leave or while a menu is open.
  useEffect(() => {
    if (!agentic || !opened) return undefined
    if (!visible) {
      void agentic.hideView(service).catch(() => undefined)
      return undefined
    }
    const place = () => {
      const rect = slotRef.current?.getBoundingClientRect()
      if (!rect) return
      void agentic.setViewBounds(service, { x: rect.left, y: rect.top, width: rect.width, height: rect.height }).catch(() => undefined)
    }
    void agentic.openView(service).then(place).catch(() => undefined)
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (slotRef.current) observer?.observe(slotRef.current)
    window.addEventListener('resize', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      void agentic.hideView(service).catch(() => undefined)
    }
  }, [agentic, service, opened, visible])

  const command = (value: 'back' | 'reload' | 'open-external') => {
    if (value === 'reload') setState('loading')
    void agentic?.viewCommand(service, value).catch(() => undefined)
  }

  return (
    <section className="agentic-page partner-view" aria-labelledby="partner-view-heading">
      <header className="partner-view__bar">
        <button type="button" className="icon-button" aria-label="Back" disabled={!canGoBack} onClick={() => command('back')}>
          <ArrowLeft size={17} aria-hidden="true" />
        </button>
        <div className="partner-view__title">
          <h1 id="partner-view-heading">{name}</h1>
          <span>Partner service. Family Circle shares nothing with it.</span>
        </div>
        {service === 'guardian-angel' ? (
          <Link className="secondary-action" to="/agentic/guardian-angel">
            <LayoutGrid size={16} aria-hidden="true" /> All templates
          </Link>
        ) : null}
        <button type="button" className="icon-button" aria-label="Reload" onClick={() => command('reload')}>
          <RefreshCw size={17} aria-hidden="true" />
        </button>
        <button type="button" className="secondary-action" onClick={() => command('open-external')}>
          <ExternalLink size={16} aria-hidden="true" /> Open in browser
        </button>
      </header>
      <div className="partner-view__slot" ref={slotRef}>
        {!agentic ? <p className="partner-view__message">Agentic Services are not available here.</p> : null}
        {agentic && state === 'failed' ? (
          <div className="partner-view__message" role="alert">
            <strong>Couldn't open {name}</strong>
            <span>Check your internet connection, then try again.</span>
            <div>
              <button type="button" className="primary-action" onClick={() => command('reload')}>Retry</button>
              <button type="button" className="secondary-action" onClick={() => command('open-external')}>Open in browser</button>
            </div>
          </div>
        ) : null}
        {agentic && state === 'loading' ? <p className="partner-view__message" role="status">Opening {name}…</p> : null}
      </div>
    </section>
  )
}
```

Note on the test `'hides the view while a menu is open…'`: the show effect calls `openView(service)` with no target, which is what `toHaveBeenCalledWith('ubercare')` checks. Two buttons are named "Open in browser" in the failed state; the header test runs while the state is `ready`, so only one exists then.

- [ ] **Step 5: Styles**

Append to `src/renderer/features/agentic/agentic.css`:

```css
.partner-view {
  height: 100%;
  min-height: 0;
  gap: 0;
  padding: 0;
}

.partner-view__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--kk-border);
  background: var(--kk-card);
}

.partner-view__title {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.partner-view__title h1 {
  margin: 0;
  color: var(--kk-text);
  font-size: 16px;
}

.partner-view__title span {
  color: var(--kk-text-muted);
  font-size: 13px;
}

.partner-view__slot {
  position: relative;
  display: grid;
  min-height: 0;
  flex: 1;
  place-items: center;
  background: var(--kk-canvas);
}

.partner-view__message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--kk-text-muted);
  font-size: 14px;
  text-align: center;
}

.partner-view__message strong {
  color: var(--kk-text);
  font-size: 16px;
}

.partner-view__message div {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
```

Check `.app-shell__content` lets a child fill its height (`grep -n "app-shell__content" -A8 src/renderer/app/App.css`). If it scrolls with padding, add `.app-shell__content:has(> .partner-view) { padding: 0; overflow: hidden; }`, so the slot fills the content area exactly.

- [ ] **Step 6: Run to see it pass**

Run: `$N node_modules/vitest/vitest.mjs run src/renderer/features/agentic`
Expected: PASS.

- [ ] **Step 7: Prove the new tests fail on the old code**

Run:

```bash
git stash push -- src/renderer/features/agentic/PartnerViewPage.tsx src/renderer/features/agentic/GuardianAngelPage.tsx
$N node_modules/vitest/vitest.mjs run src/renderer/features/agentic   # Expected: FAIL
git stash pop
```

(The stashed versions go back to the committed placeholders from Task 6 for the page under test. For GuardianAngelPage this only applies before its Task 7 commit, so run this check per page before each commit if executing tasks separately.)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/features/agentic src/renderer/app/App.css
git commit -m "feat: partner view page with secure in-app web views"
```

---

### Task 9: Full verification, real-app check, PR

**Files:**
- Modify: `docs/superpowers/specs/2026-10-16-agentic-services-design.md` (only if the build differs from the spec)

- [ ] **Step 1: Full checks**

Run:

```bash
npm run -s typecheck
node scripts/verify-boundaries.mjs
$N node_modules/vitest/vitest.mjs run
npm run -s build
```

Expected: all pass. Re-run known flaky files (#7) on their own if they time out under load.

- [ ] **Step 2: Visual check in the preview harness**

Add `agentic` to the scratchpad stub bridge (`scratchpad/preview/stub.js`) using the three `SAMPLE_CATALOG` templates, open `/agentic/guardian-angel` and `/agentic/ubercare` at 1180×720 and 1440×900 with `shots.mjs`, and run `sidebar-fit.mjs` at 720 px height. Check: the frame is green, the sidebar pill reads "Command mode", Ask pages are still blue, both sidebar groups fit or scroll without covering the Local AI card, and no text is under 13px.

- [ ] **Step 3: Real-app check (isolated profile only)**

Build and run the app with an isolated `--user-data-dir` under the scratchpad (never the real `%APPDATA%\kin-keepers-family-circle`), signed in as the test account. Drive it via `scratchpad/fc061/cdp.mjs` on port 9333. Check:
- Guardian Angel loads the live catalog, cards show avatars, and `userData/agentic/catalog.json` has no `created_by`.
- "Use this template" opens `kin-keepers.ai/templates/{id}` inside the window, placed under the header bar.
- UberCare and Marketplace load; resizing the window keeps the view in place.
- Opening the profile menu hides the view; closing it shows the view again.
- Leaving to Home hides the view and the frame turns blue.
- Disconnect the network (or block the API host) and reopen Guardian Angel: the saved copy shows with "Showing the copy from…".

Do not sign in to kin-keepers.ai or remotecarers.net with real accounts, and do not create anything on those services.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/agentic-services
gh pr create --title "feat: Agentic Services: Guardian Angel catalog and secure partner views" --body "<summary, test plan, screenshots>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Then follow the Codex review loop (wait for the review, fix findings, reply to each one, comment `@codex review` for later commits). Merge only when the user says so.
