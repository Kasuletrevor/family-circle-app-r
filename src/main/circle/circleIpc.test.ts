import { describe, expect, it, vi } from 'vitest'
import { registerCircleIpc } from './circleIpc'

describe('registerCircleIpc', () => {
  it('registers protected Circle reads and mutations without accepting renderer-supplied identity', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
    }
    const overview = {
      status: 'empty' as const,
      reason: 'no-circles' as const,
      circles: [],
      activeCircleId: null,
      viewerPersonId: null,
      tree: null,
      notifications: [],
    }
    const circles = [{ id: 'g-1', name: 'Test Family', role: 'Circle owner', memberCount: 3, isActive: true }]
    const details = {
      circle: { id: 'g-1', name: 'Test Family', role: 'Circle owner', memberCount: 2, pendingInvitationCount: 1 },
      members: [],
      invitations: [],
    }
    const service = {
      getOverview: vi.fn(async () => overview),
      getMyCircles: vi.fn(async () => circles),
      getCircleDetails: vi.fn(async () => details),
      selectCircle: vi.fn(async () => ({ success: true as const })),
      createCircle: vi.fn(async () => ({ circleId: 'g-2' })),
      inviteMember: vi.fn(async () => ({ outcome: 'sent' as const })),
      resendInvitation: vi.fn(async () => ({ outcome: 'sent' as const })),
      cancelInvitation: vi.fn(async () => ({ success: true as const })),
      removeMember: vi.fn(async () => ({ success: true as const })),
      leaveCircle: vi.fn(async () => ({ success: true as const })),
    }

    registerCircleIpc(ipc, service)

    expect([...handlers.keys()]).toEqual([
      'circle:get-overview',
      'circle:get-my-circles',
      'circle:get-details',
      'circle:select',
      'circle:create',
      'circle:invite-member',
      'circle:resend-invitation',
      'circle:cancel-invitation',
      'circle:remove-member',
      'circle:leave',
    ])

    await expect(handlers.get('circle:get-overview')?.({ sender: 'ignored' }, 'malicious-user-id')).resolves.toEqual(overview)
    expect(service.getOverview).toHaveBeenCalledWith()

    await expect(handlers.get('circle:get-my-circles')?.({ sender: 'ignored' }, 'malicious-user-id')).resolves.toEqual(circles)
    expect(service.getMyCircles).toHaveBeenCalledWith()

    await expect(handlers.get('circle:get-details')?.({ sender: 'ignored' }, { serverUserId: '999' })).resolves.toEqual(details)
    expect(service.getCircleDetails).toHaveBeenCalledWith()

    await expect(handlers.get('circle:select')?.({ sender: 'ignored' }, 'g-1', 'malicious-user-id')).resolves.toEqual({ success: true })
    expect(service.selectCircle).toHaveBeenCalledWith('g-1')

    await expect(handlers.get('circle:create')?.({ sender: 'ignored' }, {
      name: 'Kasule Family',
      fromUserId: '999',
      serverUserId: '999',
    })).resolves.toEqual({ circleId: 'g-2' })
    expect(service.createCircle).toHaveBeenCalledWith({ name: 'Kasule Family' })

    await expect(handlers.get('circle:invite-member')?.({ sender: 'ignored' }, {
      circleId: 'g-1',
      email: 'relative@example.test',
      role: 'Sibling',
      fromUserId: '999',
      serverUserId: '999',
      token: 'secret',
    })).resolves.toEqual({ outcome: 'sent' })
    expect(service.inviteMember).toHaveBeenCalledWith({
      circleId: 'g-1',
      email: 'relative@example.test',
      role: 'Sibling',
    })

    const malicious = {
      personId: 'safe-person',
      fromUserId: 'attacker',
      serverUserId: 'attacker',
      userId: 'attacker',
      invitationId: 'secret',
      token: 'secret',
      tempPassword: 'secret',
    }
    await handlers.get('circle:resend-invitation')?.({}, malicious)
    await handlers.get('circle:cancel-invitation')?.({}, malicious)
    await handlers.get('circle:remove-member')?.({}, malicious)
    expect(service.resendInvitation).toHaveBeenCalledWith({ personId: 'safe-person' })
    expect(service.cancelInvitation).toHaveBeenCalledWith({ personId: 'safe-person' })
    expect(service.removeMember).toHaveBeenCalledWith({ personId: 'safe-person' })

    await handlers.get('circle:leave')?.({}, malicious)
    expect(service.leaveCircle).toHaveBeenCalledWith()
  })
})
