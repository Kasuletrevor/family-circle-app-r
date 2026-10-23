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
    await api.agentic.openView({ service: 'ubercare' })
    expect(invoke).toHaveBeenLastCalledWith('agentic:open-view', { service: 'ubercare' })
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

const angel = {
  id: '5', name: 'Morning Check-in', description: '', templateId: '7', templateName: 'Elder Companion', avatar: null,
  runCount: 0, lastRunAt: null, trustBoundaries: [], escalationTriggers: [], runsHere: false,
}

describe('desktop My Guardian Angels API', () => {
  it('uses fixed channels and sends only ids', async () => {
    const invoke = vi.fn(async () => ({ success: true }))
    const api = createDesktopApi(invoke)
    await api.agentic.connectAngels()
    expect(invoke).toHaveBeenLastCalledWith('agentic:connect')
    await api.agentic.cancelConnectAngels()
    expect(invoke).toHaveBeenLastCalledWith('agentic:cancel-connect')
    await api.agentic.disconnectAngels()
    expect(invoke).toHaveBeenLastCalledWith('agentic:disconnect')
    await api.agentic.addAngel({ templateId: '7', url: 'https://evil.test' } as never)
    expect(invoke).toHaveBeenLastCalledWith('agentic:add-angel', { templateId: '7' })
    await api.agentic.removeAngel({ angelId: '5', force: true } as never)
    expect(invoke).toHaveBeenLastCalledWith('agentic:remove-angel', { angelId: '5' })
    await api.agentic.openView({ service: 'guardian-angel', target: { kind: 'angel', angelId: '5', page: 'run', url: 'x' } as never })
    expect(invoke).toHaveBeenLastCalledWith('agentic:open-view', { service: 'guardian-angel', target: { kind: 'angel', angelId: '5', page: 'run' } })
  })

  it('passes only valid angels in the public shape', async () => {
    const api = createDesktopApi(vi.fn(async (channel: string) => (
      channel === 'agentic:my-angels'
        ? { status: 'ready', angels: [{ ...angel, created_by: 'owner@example.test' }, { ...angel, id: '../5' }] }
        : { status: 'added', angel: { ...angel, avatar: 'https://evil.test/a.png' } }
    )))
    await expect(api.agentic.getMyAngels()).resolves.toEqual({ status: 'ready', angels: [angel] })
    await expect(api.agentic.addAngel({ templateId: '7' })).resolves.toEqual({ status: 'unavailable' })
  })

  it('maps unknown results to safe defaults', async () => {
    const api = createDesktopApi(vi.fn(async () => ({ status: 'weird', token: 'secret' })))
    await expect(api.agentic.getMyAngels()).resolves.toEqual({ status: 'unavailable' })
    await expect(api.agentic.removeAngel({ angelId: '5' })).resolves.toEqual({ status: 'unavailable' })
    await expect(api.agentic.getAngelConnection()).resolves.toEqual({ status: 'disconnected' })
    const known = createDesktopApi(vi.fn(async () => ({ status: 'not-yours' })))
    await expect(known.agentic.removeAngel({ angelId: '5' })).resolves.toEqual({ status: 'not-yours' })
  })

  it('passes connection events through a safe shape', () => {
    let deliver!: (payload: unknown) => void
    const subscribe = vi.fn((_channel: string, listener: (payload: unknown) => void) => { deliver = listener; return () => undefined })
    const api = createDesktopApi(vi.fn(), subscribe as never)
    const listener = vi.fn()
    api.agentic.onAngelConnection(listener)
    expect(subscribe).toHaveBeenCalledWith('agentic:angel-connection-changed', expect.any(Function))
    deliver({ status: 'connected', email: 'pat@example.test', access_token: 'secret' })
    expect(listener).toHaveBeenCalledWith({ status: 'connected', email: 'pat@example.test' })
  })
})

describe('desktop angel chat API', () => {
  it('uses fixed channels, sends only the id and text, and parses results safely', async () => {
    const invoke = vi.fn(async (channel: string) => channel === 'agentic:angel-chat-open'
      ? { status: 'ready', angel: { id: '5', name: 'Morning', extra: 1 }, runtime: { backend: 'llama.cpp', model: 'Qwen' }, messages: [], offline: false }
      : { status: 'replied', person: 'bad' })
    const api = createDesktopApi(invoke as never)
    await expect(api.agentic.openAngelChat({ angelId: '5', url: 'x' } as never)).resolves.toEqual({
      status: 'ready', angel: { id: '5', name: 'Morning' }, runtime: { backend: 'llama.cpp', model: 'Qwen' }, messages: [], offline: false,
    })
    expect(invoke).toHaveBeenLastCalledWith('agentic:angel-chat-open', { angelId: '5' })
    await expect(api.agentic.sendAngelMessage({ angelId: '5', text: 'Hi', extra: 1 } as never)).resolves.toEqual({ status: 'failed' })
    expect(invoke).toHaveBeenLastCalledWith('agentic:angel-chat-send', { angelId: '5', text: 'Hi' })
    await expect(api.agentic.clearAngelChat({ angelId: '5' })).resolves.toEqual({ success: true })
    expect(invoke).toHaveBeenLastCalledWith('agentic:angel-chat-clear', { angelId: '5' })
  })
})

describe('desktop saved angels API', () => {
  it('keeps only valid saved angels', async () => {
    const invoke = vi.fn(async () => [{ id: '5', name: 'Morning', recipe: 'x' }, { id: '../6', name: 'Bad' }, 'junk'])
    const api = createDesktopApi(invoke as never)
    await expect(api.agentic.getSavedAngels()).resolves.toEqual([{ id: '5', name: 'Morning' }])
    expect(invoke).toHaveBeenLastCalledWith('agentic:saved-angels')
  })
})
