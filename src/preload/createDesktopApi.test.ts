import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './createDesktopApi'

describe('createDesktopApi', () => {
  it('exposes only approved application, auth, onboarding, and protected Circle capabilities', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:get-version') return '0.1.0'
      if (channel === 'app:get-platform') return 'win32'
      if (channel === 'auth:check-invitation') return { hasPendingInvite: false, groupName: null, role: null }
      if (channel === 'auth:sign-out' || channel === 'auth:reset-password') return { success: true }
      if (channel === 'auth:request-password-reset') return {
        success: true,
        message: 'If an account exists for that email, a recovery code has been sent.',
        expiresInMinutes: 10,
      }
      if (channel === 'circle:get-overview') return {
        status: 'empty',
        reason: 'no-circles',
        circles: [],
        activeCircleId: null,
        viewerPersonId: null,
        tree: null,
        notifications: [],
      }
      if (channel === 'circle:get-my-circles') return []
      if (channel === 'circle:get-details') return null
      if (channel === 'circle:select') return { success: true }
      if (channel === 'circle:create') return { circleId: 'g-2' }
      if (channel === 'circle:invite-member' || channel === 'circle:resend-invitation') return { outcome: 'sent' }
      if (channel === 'circle:cancel-invitation' || channel === 'circle:remove-member' || channel === 'circle:leave') {
        return { success: true }
      }
      return { status: 'unauthenticated' }
    })
    const api = createDesktopApi(invoke)

    expect(Object.keys(api)).toEqual(['app', 'auth', 'onboarding', 'circle'])
    expect(Object.keys(api.app)).toEqual(['getVersion', 'getPlatform'])
    expect(Object.keys(api.auth)).toEqual([
      'restore',
      'signIn',
      'checkInvitation',
      'register',
      'signOut',
      'requestPasswordReset',
      'resetPassword',
    ])
    expect(Object.keys(api.onboarding)).toEqual([
      'getState',
      'setInitialPassword',
      'updateProfile',
      'getCircleContext',
      'complete',
    ])
    expect(Object.keys(api.circle)).toEqual([
      'getOverview',
      'getMyCircles',
      'getCircleDetails',
      'selectCircle',
      'createCircle',
      'inviteMember',
      'resendInvitation',
      'cancelInvitation',
      'removeMember',
      'leaveCircle',
    ])

    const serialized = JSON.stringify(api).toLowerCase()
    expect(serialized).not.toContain('api_key')
    expect(serialized).not.toContain('gettoken')
    expect(serialized).not.toContain('decodetoken')
    expect(serialized).not.toContain('rawfetch')
    expect(serialized).not.toContain('serveruserid')
    expect(serialized).not.toContain('fromuserid')

    await expect(api.app.getVersion()).resolves.toBe('0.1.0')
    await expect(api.app.getPlatform()).resolves.toBe('win32')
    await api.auth.restore()
    expect(invoke).toHaveBeenCalledWith('auth:restore')
    await api.auth.signIn({ email: 'a@example.com', password: '123456789012' })
    expect(invoke).toHaveBeenCalledWith('auth:sign-in', { email: 'a@example.com', password: '123456789012' })
    await api.onboarding.complete('home')
    expect(invoke).toHaveBeenCalledWith('onboarding:complete', 'home')

    await api.circle.getOverview()
    expect(invoke).toHaveBeenCalledWith('circle:get-overview')
    await api.circle.getMyCircles()
    expect(invoke).toHaveBeenCalledWith('circle:get-my-circles')
    await api.circle.getCircleDetails()
    expect(invoke).toHaveBeenCalledWith('circle:get-details')
    await api.circle.selectCircle('g-1')
    expect(invoke).toHaveBeenCalledWith('circle:select', 'g-1')
    await api.circle.createCircle({ name: 'Kasule Family' })
    expect(invoke).toHaveBeenCalledWith('circle:create', { name: 'Kasule Family' })
    await api.circle.inviteMember({
      circleId: 'g-1',
      email: 'relative@example.test',
      role: 'Sibling',
    })
    expect(invoke).toHaveBeenCalledWith('circle:invite-member', {
      circleId: 'g-1',
      email: 'relative@example.test',
      role: 'Sibling',
    })
    await api.circle.resendInvitation({ personId: 'invite:1' })
    expect(invoke).toHaveBeenCalledWith('circle:resend-invitation', { personId: 'invite:1' })
    await api.circle.cancelInvitation({ personId: 'invite:1' })
    expect(invoke).toHaveBeenCalledWith('circle:cancel-invitation', { personId: 'invite:1' })
    await api.circle.removeMember({ personId: 'user:2' })
    expect(invoke).toHaveBeenCalledWith('circle:remove-member', { personId: 'user:2' })
    await api.circle.leaveCircle()
    expect(invoke).toHaveBeenCalledWith('circle:leave')
  })
})
