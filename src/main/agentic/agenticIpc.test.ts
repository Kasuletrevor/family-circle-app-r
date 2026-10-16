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

  it('returns only public template fields', async () => {
    const { call, catalog } = register()
    catalog.get.mockResolvedValueOnce({
      status: 'ready', fetchedAt: 1, stale: false,
      templates: [{ id: '7', name: 'A', description: '', category: 'other', trustBoundaries: [], escalationTriggers: [], avatar: null, created_by: 'x@example.test' }],
    } as never)
    expect(JSON.stringify(await call('agentic:catalog'))).not.toContain('example.test')
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
