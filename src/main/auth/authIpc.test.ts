import { describe, expect, it, vi } from 'vitest'
import { registerAuthIpc } from './authIpc'

describe('registerAuthIpc', () => {
  it('registers only the approved auth and onboarding channels and forwards payloads without Electron events', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
    }
    const service = {
      restore: vi.fn(async () => ({ status: 'unauthenticated' as const })),
      signIn: vi.fn(async () => ({ status: 'unauthenticated' as const })),
      checkInvitation: vi.fn(async () => ({ hasPendingInvite: false, groupName: null, role: null })),
      register: vi.fn(async () => ({ status: 'unauthenticated' as const })),
      signOut: vi.fn(async () => ({ success: true as const })),
      requestPasswordReset: vi.fn(async () => ({ success: true as const, message: 'neutral', expiresInMinutes: 10 })),
      resetPassword: vi.fn(async () => ({ success: true as const })),
      getState: vi.fn(async () => ({ status: 'unauthenticated' as const })),
      setInitialPassword: vi.fn(async () => ({ status: 'unauthenticated' as const })),
      updateProfile: vi.fn(async () => ({ status: 'unauthenticated' as const })),
      getCircleContext: vi.fn(async () => ({ accountOrigin: 'registered' as const, invitation: null, groups: [] })),
      complete: vi.fn(async () => ({ status: 'unauthenticated' as const })),
    }

    registerAuthIpc(ipc, service)

    expect([...handlers.keys()]).toEqual([
      'auth:restore',
      'auth:sign-in',
      'auth:check-invitation',
      'auth:register',
      'auth:sign-out',
      'auth:request-password-reset',
      'auth:reset-password',
      'onboarding:get-state',
      'onboarding:set-initial-password',
      'onboarding:update-profile',
      'onboarding:get-circle-context',
      'onboarding:complete',
    ])

    const electronEvent = { sender: { id: 99 } }
    const signIn = { email: 'member@example.com', password: '123456789012' }
    await handlers.get('auth:sign-in')?.(electronEvent, signIn)
    expect(service.signIn).toHaveBeenCalledWith(signIn)

    await handlers.get('auth:check-invitation')?.(electronEvent, 'member@example.com')
    expect(service.checkInvitation).toHaveBeenCalledWith('member@example.com')

    const registration = { name: 'Family Member', email: 'member@example.com', password: '123456789012' }
    await handlers.get('auth:register')?.(electronEvent, registration)
    expect(service.register).toHaveBeenCalledWith(registration)

    await handlers.get('auth:request-password-reset')?.(electronEvent, 'member@example.com')
    expect(service.requestPasswordReset).toHaveBeenCalledWith('member@example.com')

    const reset = { email: 'member@example.com', code: '12345678', newPassword: 'abcdefghijkl' }
    await handlers.get('auth:reset-password')?.(electronEvent, reset)
    expect(service.resetPassword).toHaveBeenCalledWith(reset)

    await handlers.get('onboarding:set-initial-password')?.(electronEvent, 'abcdefghijkl')
    expect(service.setInitialPassword).toHaveBeenCalledWith('abcdefghijkl')

    await handlers.get('onboarding:update-profile')?.(electronEvent, 'New Name')
    expect(service.updateProfile).toHaveBeenCalledWith('New Name')

    await handlers.get('onboarding:complete')?.(electronEvent, 'home')
    expect(service.complete).toHaveBeenCalledWith('home')

    expect(service.restore).not.toHaveBeenCalledWith(electronEvent)
    expect(service.signIn).not.toHaveBeenCalledWith(electronEvent, signIn)
  })
})
