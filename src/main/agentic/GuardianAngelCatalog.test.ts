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

function response(body: string | Buffer, init: { status?: number; type?: string } = {}) {
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

  it('keeps calling a copy stale after a failed refresh', async () => {
    let online = true
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (!online) throw new TypeError('fetch failed')
      return String(url) === CATALOG_URL ? response(JSON.stringify([entry(1, { avatar_src: null })])) : response(PNG)
    }) as unknown as typeof fetch
    const service = catalog(fetchImpl)
    await service.get()
    online = false
    expect(await service.get({ refresh: true })).toMatchObject({ stale: true })
    expect(await service.get()).toMatchObject({ stale: true })
  })

  it('treats bad JSON, error statuses and empty lists as failures', async () => {
    for (const body of [response('not json'), response('[]'), response('{}', { status: 500 })]) {
      const result = await catalog(vi.fn(async () => body) as unknown as typeof fetch).get()
      expect(result).toEqual({ status: 'unavailable' })
    }
  })

  it('times out a hanging request', async () => {
    const hanging = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as unknown as typeof fetch
    expect(await catalog(hanging).get()).toEqual({ status: 'unavailable' })
  })

  it('times out a response whose body stalls after the headers', async () => {
    const stalled = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('['))
        init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')))
      },
    }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    expect(await catalog(stalled).get()).toEqual({ status: 'unavailable' })
  })

  it('stops reading an oversized response at the size limit', async () => {
    const pulls = { count: 0 }
    const endless = vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        pulls.count += 1
        controller.enqueue(new Uint8Array(256 * 1024))
      },
    }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    expect(await catalog(endless).get()).toEqual({ status: 'unavailable' })
    expect(pulls.count).toBeLessThan(20)
  })

  it('refuses a response that announces a size over the limit', async () => {
    const big = vi.fn(async () => new Response('[]', {
      headers: { 'content-type': 'application/json', 'content-length': String(50 * 1024 * 1024) },
    })) as unknown as typeof fetch
    expect(await catalog(big).get()).toEqual({ status: 'unavailable' })
  })

  it('limits the number of templates, parallel avatar downloads and total avatar size', async () => {
    let inFlight = 0
    let mostInFlight = 0
    const avatar = Buffer.alloc(400 * 1024, 1)
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === CATALOG_URL) return response(JSON.stringify(Array.from({ length: 150 }, (_, index) => entry(index + 1))))
      inFlight += 1
      mostInFlight = Math.max(mostInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return response(avatar, { type: 'image/png' })
    }) as unknown as typeof fetch
    const result = await new GuardianAngelCatalog({ fetch: fetchImpl, cachePath: join(folder, 'catalog.json'), timeoutMs: 5_000 }).get()
    if (result.status !== 'ready') throw new Error('expected ready')

    expect(result.templates).toHaveLength(100)
    expect(mostInFlight).toBeLessThanOrEqual(6)
    // 8 MiB of 400 KiB avatars is 20; the rest show initials.
    expect(result.templates.filter((template) => template.avatar).length).toBe(20)
    // Downloads already running when the budget runs out may finish, but no new ones start.
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(1 + 20 + 6)
  })

  it('gives avatars an overall time budget so stalled images cannot hold up the catalog', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === CATALOG_URL) return response(JSON.stringify(Array.from({ length: 30 }, (_, index) => entry(index + 1))))
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }) as unknown as typeof fetch
    const service = new GuardianAngelCatalog({ fetch: fetchImpl, cachePath: join(folder, 'catalog.json'), timeoutMs: 1_000, avatarBudgetMs: 100 })

    const started = Date.now()
    const result = await service.get()
    // Without a budget this would take ceil(30 / 6) x 1 s.
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(result).toMatchObject({ status: 'ready' })
    if (result.status === 'ready') expect(result.templates.every((template) => template.avatar === null)).toBe(true)
  })

  it('shares one download between overlapping refreshes', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetchImpl = vi.fn(async () => {
      await gate
      return response(JSON.stringify([entry(1, { avatar_src: null })]))
    }) as unknown as typeof fetch
    const service = catalog(fetchImpl)

    const results = [service.get({ refresh: true }), service.get({ refresh: true }), service.get({ refresh: true })]
    release()
    const settled = await Promise.all(results)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(settled.every((result) => result.status === 'ready')).toBe(true)
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
