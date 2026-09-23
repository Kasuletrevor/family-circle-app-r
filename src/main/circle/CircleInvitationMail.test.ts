import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import { CircleService } from './CircleService'

const owner: AuthUser = {
  id: 7,
  email: 'owner@example.test',
  name: 'Owner Example',
  accountOrigin: 'registered',
  mustChangePassword: false,
  onboardingCompleted: true,
}

const delivery = {
  to: 'relative@example.test',
  circleName: 'Kasule Family',
  role: 'Sibling',
  temporaryPassword: 'TEMP-2468',
}

function setup() {
  const sessions = { restore: vi.fn(async () => owner) }
  const users = {
    getRecordById: vi.fn(async () => ({
      user: owner,
      passwordHash: 'hidden',
      serverUserId: '88',
      activeCircleId: 'g-1',
      sessionVersion: 0,
      invitation: null,
    })),
    setServerUserId: vi.fn(async () => undefined),
    setActiveCircleId: vi.fn(async () => undefined),
  }
  const circle = {
    listGroups: vi.fn(async () => [
      { id: 'g-1', name: 'Kasule Family', ownerId: '88', role: 'Circle owner' },
    ]),
    getTree: vi.fn(async () => ({
      group: { id: 'g-1', name: 'Kasule Family', ownerId: '88' },
      people: [
        { id: 'user:88', kind: 'user' as const, userId: '88', name: 'Owner', email: 'owner@example.test', role: 'Parent' },
        { id: 'invite:inv-1', kind: 'invite' as const, userId: null, invitationId: 'inv-1', name: 'relative@example.test', email: 'relative@example.test', role: 'Sibling' },
      ],
      relations: [],
      positions: [],
    })),
    getNotifications: vi.fn(async () => []),
    markNotificationsRead: vi.fn(async () => ({ success: true as const })),
    ensureSharedUser: vi.fn(async () => ({ serverUserId: '88' })),
    createCircle: vi.fn(),
    addTreeRelation: vi.fn(async () => ({ success: true as const })),
    deleteTreeRelation: vi.fn(async () => ({ success: true as const })),
    saveTreePosition: vi.fn(async () => ({ success: true as const })),
    inviteMember: vi.fn(async () => ({ outcome: 'sent' as const, delivery })),
    getInvitationDelivery: vi.fn(async () => ({ temporaryPassword: 'FALLBACK-PASSWORD' })),
    cancelInvitation: vi.fn(async () => ({ success: true as const })),
    removeMember: vi.fn(async () => ({ success: true as const })),
    leaveCircle: vi.fn(async () => ({ success: true as const })),
  }
  const mailer = {
    sendInvitation: vi.fn(async () => undefined),
  }

  return {
    circle,
    mailer,
    service: new CircleService(sessions, users, circle, mailer),
  }
}

describe('Circle invitation mail delivery', () => {
  it('uses client-mode delivery material returned with the shared invitation record', async () => {
    const { service, circle, mailer } = setup()

    await expect(service.inviteMember({
      circleId: 'g-1',
      email: 'relative@example.test',
      role: 'Sibling',
    })).resolves.toEqual({ outcome: 'sent' })

    expect(circle.getInvitationDelivery).not.toHaveBeenCalled()
    expect(mailer.sendInvitation).toHaveBeenCalledWith(delivery)
  })

  it('uses the same mail API when resending and reports our delivery failure safely', async () => {
    const { service, circle, mailer } = setup()
    circle.inviteMember.mockResolvedValue({ outcome: 'already-pending', delivery } as never)

    await expect(service.resendInvitation({ personId: 'invite:inv-1' })).resolves.toEqual({ outcome: 'sent' })
    expect(circle.getInvitationDelivery).not.toHaveBeenCalled()
    expect(mailer.sendInvitation).toHaveBeenCalledTimes(1)

    mailer.sendInvitation.mockRejectedValueOnce(new Error('provider details must stay private'))
    await expect(service.resendInvitation({ personId: 'invite:inv-1' })).resolves.toEqual({ outcome: 'delivery-failed' })
  })

  it('falls back to the protected invitation check for older compatibility servers', async () => {
    const { service, circle, mailer } = setup()
    circle.inviteMember.mockResolvedValue({ outcome: 'sent' } as never)

    await expect(service.inviteMember({
      circleId: 'g-1',
      email: 'relative@example.test',
      role: 'Sibling',
    })).resolves.toEqual({ outcome: 'sent' })

    expect(circle.getInvitationDelivery).toHaveBeenCalledWith('relative@example.test')
    expect(mailer.sendInvitation).toHaveBeenCalledWith({
      to: 'relative@example.test',
      circleName: 'Kasule Family',
      role: 'Sibling',
      temporaryPassword: 'FALLBACK-PASSWORD',
    })
  })
})
