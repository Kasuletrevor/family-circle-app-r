import { describe, expect, it, vi } from 'vitest'
import { registerAgenticIpc } from './agenticIpc'

const ANGEL = {
  id: '5', name: 'Morning Check-in', description: '', templateId: '7', templateName: 'Elder Companion', avatar: null,
  runCount: 0, lastRunAt: null, trustBoundaries: [], escalationTriggers: [], runsHere: false,
}

function register() {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()
  const catalog = { get: vi.fn(async () => ({ status: 'unavailable' as const })) }
  const views = { open: vi.fn(async () => undefined), setBounds: vi.fn(), hide: vi.fn(), command: vi.fn() }
  const angels = {
    connection: vi.fn(async () => ({ status: 'connected', email: 'pat@example.test', token: 'secret' })),
    connect: vi.fn(async () => undefined),
    cancelConnect: vi.fn(),
    disconnect: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ status: 'ready', angels: [{ ...ANGEL, created_by: 'owner@example.test' }] })),
    add: vi.fn(async () => ({ status: 'added', angel: { ...ANGEL, created_by: 'owner@example.test' } })),
    remove: vi.fn(async () => ({ status: 'removed', extra: 1 })),
  }
  const chat = {
    open: vi.fn(async () => ({ status: 'not-here' as const })),
    send: vi.fn(async () => ({ status: 'failed' as const })),
    clear: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
  }
  registerAgenticIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, { catalog, views, angels: angels as never, chat })
  const call = (channel: string, payload?: unknown) => Promise.resolve().then(() => handlers.get(channel)!({}, payload))
  return { call, catalog, views, angels, chat }
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

  it('reports the angel connection without anything extra', async () => {
    const { call } = register()
    await expect(call('agentic:angel-connection')).resolves.toEqual({ status: 'connected', email: 'pat@example.test' })
  })

  it('connects, cancels and disconnects', async () => {
    const { call, angels } = register()
    await expect(call('agentic:connect')).resolves.toEqual({ success: true })
    await expect(call('agentic:cancel-connect')).resolves.toEqual({ success: true })
    await expect(call('agentic:disconnect')).resolves.toEqual({ success: true })
    expect(angels.connect).toHaveBeenCalled()
    expect(angels.cancelConnect).toHaveBeenCalled()
    expect(angels.disconnect).toHaveBeenCalled()
  })

  it('returns only public angel fields', async () => {
    const { call } = register()
    const listed = await call('agentic:my-angels')
    const added = await call('agentic:add-angel', { templateId: '7' })
    expect(listed).toEqual({ status: 'ready', angels: [ANGEL] })
    expect(added).toEqual({ status: 'added', angel: ANGEL })
    await expect(call('agentic:remove-angel', { angelId: '5' })).resolves.toEqual({ status: 'removed' })
  })

  it('checks ids before adding or removing', async () => {
    const { call, angels } = register()
    for (const bad of [{ templateId: '7/../1' }, { templateId: 7 }, {}]) await expect(call('agentic:add-angel', bad)).rejects.toThrow()
    for (const bad of [{ angelId: '../5' }, { angelId: 5 }]) await expect(call('agentic:remove-angel', bad)).rejects.toThrow()
    expect(angels.add).not.toHaveBeenCalled()
    expect(angels.remove).not.toHaveBeenCalled()
  })

  it('opens own angel pages only with a valid id and page', async () => {
    const { call, views } = register()
    await call('agentic:open-view', { service: 'guardian-angel', target: { kind: 'angel', angelId: '5', page: 'run' } })
    expect(views.open).toHaveBeenCalledWith('guardian-angel', { kind: 'angel', angelId: '5', page: 'run' })
    await expect(call('agentic:open-view', { service: 'guardian-angel', target: { kind: 'angel', angelId: '5', page: 'admin' } })).rejects.toThrow()
  })
})

describe('angel chat IPC', () => {
  it('opens, sends and clears angel chats with validated input', async () => {
    const { call, chat } = register()
    await expect(call('agentic:angel-chat-open', { angelId: '5' })).resolves.toEqual({ status: 'not-here' })
    expect(chat.open).toHaveBeenCalledWith('5')
    await call('agentic:angel-chat-send', { angelId: '5', text: 'Hi' })
    expect(chat.send).toHaveBeenCalledWith('5', 'Hi')
    await expect(call('agentic:angel-chat-send', { angelId: '5', text: 'x'.repeat(1001) })).rejects.toThrow()
    await expect(call('agentic:angel-chat-send', { angelId: '5', text: 5 })).rejects.toThrow()
    await expect(call('agentic:angel-chat-open', { angelId: '../5' })).rejects.toThrow()
    await expect(call('agentic:angel-chat-clear', { angelId: '5' })).resolves.toEqual({ success: true })
    expect(chat.clear).toHaveBeenCalledWith('5')
    expect(chat.send).toHaveBeenCalledTimes(1)
  })

  it('forgets the local conversation only when an angel is removed', async () => {
    const { call, chat, angels } = register()
    await call('agentic:remove-angel', { angelId: '5' })
    expect(chat.forget).toHaveBeenCalledWith('5')
    angels.remove.mockResolvedValueOnce({ status: 'not-yours' } as never)
    await call('agentic:remove-angel', { angelId: '6' })
    expect(chat.forget).toHaveBeenCalledTimes(1)
  })
})
