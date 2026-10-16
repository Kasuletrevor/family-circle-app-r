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
