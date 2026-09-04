import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import { CircleService } from './CircleService'

const user: AuthUser = {
  id: 7,
  email: 'viewer@example.test',
  name: 'Viewer Example',
  accountOrigin: 'existing',
  mustChangePassword: false,
  onboardingCompleted: true,
}

function tree(ownerId = '88') {
  return {
    group: { id: 'g-1', name: 'Test Family', ownerId },
    people: [
      { id: 'user:88', kind: 'user' as const, userId: '88', name: 'Owner', email: 'owner@example.test', role: 'Parent' },
      { id: 'user:99', kind: 'user' as const, userId: '99', name: 'Sibling', email: 'sibling@example.test', role: 'Sibling' },
      { id: 'invite:inv-1', kind: 'invite' as const, userId: null, invitationId: 'inv-1', name: 'pending@example.test', email: 'pending@example.test', role: 'Child' },
      { id: 'placeholder:p-1', kind: 'placeholder' as const, userId: null, name: 'Future relative', email: null, role: 'Family member' },
    ],
    relations: [],
    positions: [],
  }
}

function setup(options: {
  serverUserId?: string | null
  activeCircleId?: string | null
  ownerId?: string
  groupsAfterLeave?: Array<{ id: string; name: string; ownerId: string; role: string }>
} = {}) {
  const serverUserId = options.serverUserId === undefined ? '88' : options.serverUserId
  const ownerId = options.ownerId ?? '88'
  const initialGroups = [{
    id: 'g-1',
    name: 'Test Family',
    ownerId,
    role: ownerId === serverUserId ? 'Circle owner' : 'Sibling',
  }]
  const sessions = { restore: vi.fn(async () => user) }
  const users = {
    getRecordById: vi.fn(async () => ({
      user,
      passwordHash: 'hidden',
      serverUserId,
      activeCircleId: options.activeCircleId === undefined ? 'g-1' : options.activeCircleId,
      sessionVersion: 0,
      invitation: null,
    })),
    setServerUserId: vi.fn(async () => undefined),
    setActiveCircleId: vi.fn(async () => undefined),
  }
  const circle = {
    listGroups: vi.fn()
      .mockResolvedValueOnce(initialGroups)
      .mockResolvedValue(options.groupsAfterLeave ?? initialGroups),
    getTree: vi.fn(async () => tree(ownerId)),
    getNotifications: vi.fn(async () => []),
    ensureSharedUser: vi.fn(async () => ({ serverUserId: '88' })),
    createCircle: vi.fn(),
    inviteMember: vi.fn(async () => ({ outcome: 'already-pending' as const })),
    cancelInvitation: vi.fn(async () => ({ success: true as const })),
    removeMember: vi.fn(async () => ({ success: true as const })),
    leaveCircle: vi.fn(async () => ({ success: true as const })),
  }
  return { users, circle, service: new CircleService(sessions, users, circle) }
}

describe('CircleService management boundary', () => {
  it('returns safe active-Circle details with truthful counts and no internal identities', async () => {
    const { service } = setup()
    const details = await service.getCircleDetails()

    expect(details).toEqual({
      circle: {
        id: 'g-1',
        name: 'Test Family',
        role: 'Circle owner',
        memberCount: 2,
        pendingInvitationCount: 1,
      },
      members: [
        { personId: 'user:88', name: 'Owner', email: 'owner@example.test', role: 'Parent', isViewer: true, isOwner: true },
        { personId: 'user:99', name: 'Sibling', email: 'sibling@example.test', role: 'Sibling', isViewer: false, isOwner: false },
      ],
      invitations: [
        { personId: 'invite:inv-1', email: 'pending@example.test', role: 'Child', status: 'pending' },
      ],
    })
    const serialized = JSON.stringify(details)
    expect(serialized).not.toContain('userId')
    expect(serialized).not.toContain('ownerId')
    expect(serialized).not.toContain('invitationId')
  })

  it('returns null and clears stale active selection when there is no shared identity', async () => {
    const { service, users, circle } = setup({ serverUserId: null })
    await expect(service.getCircleDetails()).resolves.toBeNull()
    expect(users.setActiveCircleId).toHaveBeenCalledWith(7, null)
    expect(circle.listGroups).not.toHaveBeenCalled()
  })

  it('resends a pending invitation from authoritative tree email and role', async () => {
    const { service, circle } = setup()
    await expect(service.resendInvitation({ personId: 'invite:inv-1' })).resolves.toEqual({ outcome: 'sent' })
    expect(circle.inviteMember).toHaveBeenCalledWith({
      serverUserId: '88',
      circleId: 'g-1',
      email: 'pending@example.test',
      role: 'Child',
    })
  })

  it('cancels a pending invitation by internally resolved invitation ID', async () => {
    const { service, circle } = setup()
    await expect(service.cancelInvitation({ personId: 'invite:inv-1' })).resolves.toEqual({ success: true })
    expect(circle.cancelInvitation).toHaveBeenCalledWith({ serverUserId: '88', circleId: 'g-1', invitationId: 'inv-1' })
  })

  it('removes a confirmed non-owner by internally resolved shared user ID', async () => {
    const { service, circle } = setup()
    await expect(service.removeMember({ personId: 'user:99' })).resolves.toEqual({ success: true })
    expect(circle.removeMember).toHaveBeenCalledWith({ serverUserId: '88', circleId: 'g-1', targetServerUserId: '99' })
  })

  it('rejects owner-only actions for a non-owner and never calls legacy writes', async () => {
    const { service, circle } = setup({ serverUserId: '99', ownerId: '88' })
    await expect(service.resendInvitation({ personId: 'invite:inv-1' })).rejects.toThrow('Only the Circle owner')
    await expect(service.cancelInvitation({ personId: 'invite:inv-1' })).rejects.toThrow('Only the Circle owner')
    await expect(service.removeMember({ personId: 'user:88' })).rejects.toThrow('Only the Circle owner')
    expect(circle.inviteMember).not.toHaveBeenCalled()
    expect(circle.cancelInvitation).not.toHaveBeenCalled()
    expect(circle.removeMember).not.toHaveBeenCalled()
  })

  it('never removes the Circle owner and rejects stale safe person handles', async () => {
    const { service, circle } = setup()
    await expect(service.removeMember({ personId: 'user:88' })).rejects.toThrow('Circle owner cannot be removed')
    await expect(service.removeMember({ personId: 'gone' })).rejects.toThrow('no longer in this Circle')
    await expect(service.cancelInvitation({ personId: 'gone' })).rejects.toThrow('no longer pending')
    expect(circle.removeMember).not.toHaveBeenCalled()
  })

  it('lets a non-owner leave and selects a safe fallback Circle', async () => {
    const fallback = { id: 'g-2', name: 'Other Family', ownerId: '77', role: 'Sibling' }
    const { service, users, circle } = setup({
      serverUserId: '99',
      ownerId: '88',
      groupsAfterLeave: [fallback],
    })
    await expect(service.leaveCircle()).resolves.toEqual({ success: true })
    expect(circle.leaveCircle).toHaveBeenCalledWith({ serverUserId: '99', circleId: 'g-1' })
    expect(users.setActiveCircleId).toHaveBeenCalledWith(7, 'g-2')
  })

  it('prevents an owner from leaving their own Circle', async () => {
    const { service, circle } = setup()
    await expect(service.leaveCircle()).rejects.toThrow('Circle owners cannot leave')
    expect(circle.leaveCircle).not.toHaveBeenCalled()
  })
})
