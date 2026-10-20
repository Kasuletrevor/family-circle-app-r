import { describe, expect, it, vi } from 'vitest'
import { createAngelsController } from './angelsController'

const DONE = 'https://kin-keepers.ai/connect/done?code=code-abcdefghijklmnop'

function setup(account: string | null = 'acct1') {
  const connection = {
    useAccount: vi.fn(async () => undefined),
    status: vi.fn(() => ({ status: 'disconnected' as const })),
    begin: vi.fn(() => 'https://kin-keepers.ai/connect?app=family-circle&challenge=abc'),
    cancel: vi.fn(),
    complete: vi.fn(async () => true),
    disconnect: vi.fn(async () => undefined),
  }
  const angels = {
    list: vi.fn(async () => ({ status: 'ready' as const, angels: [] })),
    add: vi.fn(async () => ({ status: 'not-found' as const })),
    remove: vi.fn(async () => ({ status: 'removed' as const })),
  }
  const openPage = vi.fn(async () => undefined)
  const controller = createAngelsController({ connection, angels, openPage, accountKey: async () => account })
  return { controller, connection, angels, openPage }
}

describe('angelsController', () => {
  it('connects for the signed-in account in the Guardian Angel view', async () => {
    const { controller, connection, openPage } = setup()
    await controller.connect()
    expect(connection.useAccount).toHaveBeenCalledWith('acct1')
    expect(openPage).toHaveBeenCalledWith('guardian-angel', 'https://kin-keepers.ai/connect?app=family-circle&challenge=abc')
  })

  it('refuses to connect and reports disconnected when nobody is signed in', async () => {
    const { controller, connection, angels } = setup(null)
    await expect(controller.connect()).rejects.toThrow()
    expect(connection.begin).not.toHaveBeenCalled()
    expect(connection.useAccount).toHaveBeenCalledWith(null)
    await expect(controller.list()).resolves.toEqual({ status: 'disconnected' })
    await expect(controller.add('7')).resolves.toEqual({ status: 'disconnected' })
    await expect(controller.remove('5')).resolves.toEqual({ status: 'disconnected' })
    expect(angels.list).not.toHaveBeenCalled()
    expect(angels.add).not.toHaveBeenCalled()
    expect(angels.remove).not.toHaveBeenCalled()
  })

  it('passes requests through for the signed-in account', async () => {
    const { controller, angels, connection } = setup()
    await controller.list()
    await controller.add('7')
    await controller.remove('5')
    expect(angels.add).toHaveBeenCalledWith('7')
    expect(angels.remove).toHaveBeenCalledWith('5')
    await expect(controller.connection()).resolves.toEqual({ status: 'disconnected' })
    controller.cancelConnect()
    await controller.disconnect()
    expect(connection.cancel).toHaveBeenCalled()
    expect(connection.disconnect).toHaveBeenCalled()
  })

  it("takes only the Guardian Angel view's connect-done page", () => {
    const { controller, connection } = setup()
    expect(controller.interceptNavigation('marketplace', DONE)).toBe(false)
    expect(controller.interceptNavigation('guardian-angel', 'https://kin-keepers.ai/templates/7')).toBe(false)
    expect(connection.complete).not.toHaveBeenCalled()
    expect(controller.interceptNavigation('guardian-angel', DONE)).toBe(true)
    expect(connection.complete).toHaveBeenCalledWith('code-abcdefghijklmnop')
  })
})
