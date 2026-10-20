import { describe, expect, it, vi } from 'vitest'
import type { PartnerServiceKey, PartnerViewState } from '../../shared/agentic'
import { PartnerViews, type PartnerViewHandle } from './PartnerViews'

type FakeHandle = PartnerViewHandle & { url: string; visible: boolean }

function setup(account: string | null = 'acct1') {
  const views: Array<{
    service: PartnerServiceKey
    partition: string
    handle: FakeHandle
    status: (state: PartnerViewState, canGoBack: boolean) => void
    intercept: (url: string) => boolean
  }> = []
  const host = {
    createView: vi.fn((
      service: PartnerServiceKey,
      partition: string,
      onStatus: (state: PartnerViewState, canGoBack: boolean) => void,
      intercept: (url: string) => boolean,
    ) => {
      const handle: FakeHandle = {
        url: '',
        visible: false,
        load: vi.fn((url: string) => { handle.url = url }),
        setBounds: vi.fn(),
        setVisible: vi.fn((visible: boolean) => { handle.visible = visible }),
        goBack: vi.fn(),
        currentUrl: () => handle.url,
        destroy: vi.fn(),
      }
      views.push({ service, partition, handle, status: onStatus, intercept })
      return handle
    }),
    openExternal: vi.fn(),
    contentSize: () => ({ width: 1000, height: 700 }),
  }
  let key = account
  const emit = vi.fn()
  const interceptNavigation = vi.fn((_service: PartnerServiceKey, url: string) => url.startsWith('https://kin-keepers.ai/connect/done'))
  const manager = new PartnerViews({ host, accountKey: async () => key, emit, interceptNavigation })
  return { manager, host, views, emit, interceptNavigation, signInAs: (next: string | null) => { key = next } }
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

  it('drops an open that was still checking the account when everything was closed', async () => {
    let finishCheck!: (key: string) => void
    const { manager, host } = setup()
    ;(manager as unknown as { deps: { accountKey(): Promise<string | null> } }).deps.accountKey = () => new Promise((resolve) => { finishCheck = resolve })
    const opening = manager.open('ubercare')
    manager.destroyAll()
    finishCheck('acct1')
    await opening
    expect(host.createView).not.toHaveBeenCalled()
  })

  it('hides and destroys views', async () => {
    const { manager, views } = setup()
    await manager.open('ubercare')
    manager.hide('ubercare')
    expect(views[0]!.handle.visible).toBe(false)
    manager.destroyAll()
    expect(views[0]!.handle.destroy).toHaveBeenCalled()
  })

  it('opens a page built in the main process, on the service hosts only', async () => {
    const { manager, views, host } = setup()
    await manager.openPage('guardian-angel', 'https://kin-keepers.ai/connect?app=family-circle&challenge=abc')
    expect(views[0]!.handle.url).toBe('https://kin-keepers.ai/connect?app=family-circle&challenge=abc')
    expect(views[0]!.handle.visible).toBe(true)
    await expect(manager.openPage('guardian-angel', 'https://evil.test/connect')).rejects.toThrow()
    await expect(manager.openPage('ubercare', 'https://kin-keepers.ai/connect')).rejects.toThrow()
    expect(host.createView).toHaveBeenCalledTimes(1)
  })

  it('opens the settings page of an own angel', async () => {
    const { manager, views } = setup()
    await manager.open('guardian-angel', { kind: 'angel', angelId: '12', page: 'edit' })
    expect(views[0]!.handle.url).toBe('https://kin-keepers.ai/agents/12/edit')
  })

  it('returns to the start page after a navigation Family Circle handled', async () => {
    const { manager, views, interceptNavigation } = setup()
    await manager.openPage('guardian-angel', 'https://kin-keepers.ai/connect?app=family-circle&challenge=abc')
    expect(views[0]!.intercept('https://kin-keepers.ai/templates/7')).toBe(false)
    await Promise.resolve()
    expect(views[0]!.handle.url).toBe('https://kin-keepers.ai/connect?app=family-circle&challenge=abc')
    expect(views[0]!.intercept('https://kin-keepers.ai/connect/done?code=abc')).toBe(true)
    expect(interceptNavigation).toHaveBeenLastCalledWith('guardian-angel', 'https://kin-keepers.ai/connect/done?code=abc')
    await Promise.resolve()
    expect(views[0]!.handle.url).toBe('https://kin-keepers.ai/')
  })
})
