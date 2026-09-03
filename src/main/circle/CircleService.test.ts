import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import { CircleService } from './CircleService'

const user: AuthUser = {
  id: 7,
  email: 'member@example.test',
  name: 'Member Example',
  accountOrigin: 'invited',
  mustChangePassword: false,
  onboardingCompleted: true,
}

function setup(options: {
  sessionUser?: AuthUser | null
  serverUserId?: string | null
  groups?: Array<{ id: string; name: string; ownerId: string; role: string }>
} = {}) {
  const sessions = {
    restore: vi.fn(async () => options.sessionUser === undefined ? user : options.sessionUser),
  }
  const users = {
    getRecordById: vi.fn(async () => ({
      user,
      passwordHash: 'hidden',
      serverUserId: options.serverUserId === undefined ? '88' : options.serverUserId,
      sessionVersion: 0,
      invitation: { groupId: 'g-1', groupName: 'Test Family', role: 'Family member' },
    })),
  }
  const circle = {
    listGroups: vi.fn(async () => options.groups ?? [
      { id: 'g-1', name: 'Test Family', ownerId: '1', role: 'Family member' },
      { id: 'g-2', name: 'Other Family', ownerId: '88', role: 'Circle owner' },
    ]),
    getTree: vi.fn(async () => ({
      group: { id: 'g-1', name: 'Test Family', ownerId: '1' },
      people: [
        { id: 'user:1', kind: 'user', userId: '1', name: 'Circle Owner', email: 'owner@example.test', role: 'Circle owner' },
        { id: 'user:88', kind: 'user', userId: '88', name: 'Member Example', email: 'member@example.test', role: 'Family member' },
        { id: 'invite:i-1', kind: 'invite', userId: null, name: 'Pending Cousin', email: 'cousin@example.test', role: 'Family member' },
      ],
      relations: [{ id: 'r-1', kind: 'sibling', aPersonId: 'user:1', bPersonId: 'user:88' }],
      positions: [{ personId: 'user:1', x: 10, y: 100 }, { personId: 'user:88', x: 20, y: 300 }],
    })),
    getNotifications: vi.fn(async () => [
      {
        id: 'n-1',
        type: 'member_joined',
        title: 'A family member joined Test Family',
        message: 'The circle membership was updated.',
        groupId: 'g-1',
        groupName: 'Test Family',
        createdAt: 1_700_000_000_000,
        read: false,
      },
    ]),
  }
  return { sessions, users, circle, service: new CircleService(sessions, users, circle) }
}

describe('CircleService', () => {
  it('rejects reads when there is no protected desktop session', async () => {
    const { service, users, circle } = setup({ sessionUser: null })
    await expect(service.getOverview()).rejects.toThrow('sign in')
    expect(users.getRecordById).not.toHaveBeenCalled()
    expect(circle.listGroups).not.toHaveBeenCalled()
  })

  it('returns a safe empty state for a local account that is not linked to a shared Circle identity', async () => {
    const { service, circle } = setup({ serverUserId: null })
    await expect(service.getOverview()).resolves.toEqual({
      status: 'empty',
      reason: 'not-linked',
      circles: [],
      activeCircleId: null,
      tree: null,
      notifications: [],
    })
    expect(circle.listGroups).not.toHaveBeenCalled()
  })

  it('returns no-circle state without requesting tree data when the linked user has no memberships', async () => {
    const { service, circle } = setup({ groups: [] })
    await expect(service.getOverview()).resolves.toMatchObject({
      status: 'empty',
      reason: 'no-circles',
      circles: [],
      activeCircleId: null,
    })
    expect(circle.getTree).not.toHaveBeenCalled()
    expect(circle.getNotifications).toHaveBeenCalledWith('88')
  })

  it('uses only the protected account server identity and prefers its invited Circle as the active Circle', async () => {
    const { service, circle } = setup()
    const overview = await service.getOverview()

    expect(circle.listGroups).toHaveBeenCalledWith('88')
    expect(circle.getTree).toHaveBeenCalledWith('g-1', '88')
    expect(circle.getNotifications).toHaveBeenCalledWith('88')
    expect(overview).toMatchObject({
      status: 'ready',
      activeCircleId: 'g-1',
      circles: [
        { id: 'g-1', name: 'Test Family', ownerId: '1', role: 'Family member' },
        { id: 'g-2', name: 'Other Family', ownerId: '88', role: 'Circle owner' },
      ],
      tree: {
        group: { id: 'g-1', name: 'Test Family', ownerId: '1' },
        people: [{ id: 'user:1' }, { id: 'user:88' }, { id: 'invite:i-1' }],
        relations: [{ id: 'r-1', kind: 'sibling' }],
      },
      notifications: [{ id: 'n-1', type: 'member_joined', read: false }],
    })
  })
})
