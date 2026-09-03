import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import { CircleService } from './CircleService'

const memberUser: AuthUser = {
  id: 7,
  email: 'member@example.test',
  name: 'Member Example',
  accountOrigin: 'invited',
  mustChangePassword: false,
  onboardingCompleted: true,
}

const ownerUser: AuthUser = {
  ...memberUser,
  email: 'owner@example.test',
  name: 'Owner Name',
  accountOrigin: 'registered',
}

const defaultGroups = [
  { id: 'g-1', name: 'Test Family', ownerId: '1', role: 'Family member' },
  { id: 'g-2', name: 'Other Family', ownerId: '88', role: 'Circle owner' },
]

function treeFor(groupId: string, name: string, ownerId: string, memberCount: number, viewerId = '88') {
  const people = Array.from({ length: memberCount }, (_, index) => ({
    id: `user:${index === 0 ? viewerId : index + 100}`,
    kind: 'user' as const,
    userId: index === 0 ? viewerId : String(index + 100),
    name: index === 0 ? 'Member Example' : `Family Member ${index}`,
    email: index === 0 ? 'member@example.test' : `member${index}@example.test`,
    role: index === 0 ? 'Family member' : 'Family member',
  }))

  return {
    group: { id: groupId, name, ownerId },
    people,
    relations: memberCount > 1
      ? [{ id: `${groupId}-r-1`, kind: 'sibling', aPersonId: people[0].id, bPersonId: people[1].id }]
      : [],
    positions: people.map((person, index) => ({ personId: person.id, x: index * 10, y: index * 100 })),
  }
}

function setup(options: {
  sessionUser?: AuthUser | null
  serverUserId?: string | null
  activeCircleId?: string | null
  invitationGroupId?: string | null
  groups?: Array<{ id: string; name: string; ownerId: string; role: string }>
  trees?: Record<string, ReturnType<typeof treeFor>>
  ensureSharedUserResult?: string
  createCircleError?: Error | null
} = {}) {
  const sessionUser = options.sessionUser === undefined ? memberUser : options.sessionUser
  const serverUserId = options.serverUserId === undefined ? '88' : options.serverUserId
  const groups = options.groups ?? defaultGroups
  const trees = options.trees ?? {
    'g-1': treeFor('g-1', 'Test Family', '1', 3),
    'g-2': treeFor('g-2', 'Other Family', '88', 8),
  }

  const sessions = {
    restore: vi.fn(async () => sessionUser),
  }
  const users = {
    getRecordById: vi.fn(async () => ({
      user: sessionUser ?? memberUser,
      passwordHash: 'hidden',
      serverUserId,
      activeCircleId: options.activeCircleId ?? null,
      sessionVersion: 0,
      invitation: options.invitationGroupId === null
        ? null
        : {
            groupId: options.invitationGroupId ?? 'g-1',
            groupName: 'Test Family',
            role: 'Family member',
          },
    })),
    setServerUserId: vi.fn(async () => undefined),
    setActiveCircleId: vi.fn(async () => undefined),
  }
  const circle = {
    listGroups: vi.fn(async () => groups),
    getTree: vi.fn(async (groupId: string) => {
      const tree = trees[groupId]
      if (!tree) throw new Error('Circle was not found')
      return tree
    }),
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
    ensureSharedUser: vi.fn(async () => ({ serverUserId: options.ensureSharedUserResult ?? '88' })),
    createCircle: options.createCircleError
      ? vi.fn(async () => { throw options.createCircleError })
      : vi.fn(async ({ serverUserId: ownerId, name }: { serverUserId: string; name: string }) => ({
          id: 'circle-1',
          name,
          ownerId,
          role: 'Circle owner',
        })),
    inviteMember: vi.fn(async () => ({ outcome: 'sent' as const })),
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
      viewerPersonId: null,
      tree: null,
      notifications: [],
    })
    expect(circle.listGroups).not.toHaveBeenCalled()
  })

  it('returns no-circle state, clears stale local selection, and does not request tree data', async () => {
    const { service, circle, users } = setup({ groups: [], activeCircleId: 'gone' })
    await expect(service.getOverview()).resolves.toMatchObject({
      status: 'empty',
      reason: 'no-circles',
      circles: [],
      activeCircleId: null,
      viewerPersonId: null,
    })
    expect(circle.getTree).not.toHaveBeenCalled()
    expect(circle.getNotifications).toHaveBeenCalledWith('88')
    expect(users.setActiveCircleId).toHaveBeenCalledWith(7, null)
  })

  it('uses the local active Circle preference and strips shared service identities from the public overview', async () => {
    const { service, circle } = setup({ activeCircleId: 'g-2' })
    const overview = await service.getOverview()

    expect(circle.listGroups).toHaveBeenCalledWith('88')
    expect(circle.getTree).toHaveBeenCalledWith('g-2', '88')
    expect(circle.getNotifications).toHaveBeenCalledWith('88')
    expect(overview).toMatchObject({
      status: 'ready',
      activeCircleId: 'g-2',
      viewerPersonId: 'user:88',
      circles: [
        { id: 'g-1', name: 'Test Family', role: 'Family member' },
        { id: 'g-2', name: 'Other Family', role: 'Circle owner' },
      ],
      tree: {
        group: { id: 'g-2', name: 'Other Family' },
        people: [{ id: 'user:88' }],
      },
    })
    expect(JSON.stringify(overview)).not.toContain('ownerId')
    expect(JSON.stringify(overview)).not.toContain('userId')
  })

  it('repairs a stale active Circle preference using the invited Circle fallback', async () => {
    const { service, users, circle } = setup({ activeCircleId: 'gone', invitationGroupId: 'g-1' })
    await expect(service.getOverview()).resolves.toMatchObject({ status: 'ready', activeCircleId: 'g-1' })
    expect(circle.getTree).toHaveBeenCalledWith('g-1', '88')
    expect(users.setActiveCircleId).toHaveBeenCalledWith(7, 'g-1')
  })

  it('returns authoritative member counts for every Circle rather than reusing the active tree count', async () => {
    const { service, circle } = setup({ activeCircleId: 'g-1' })
    await expect(service.getMyCircles()).resolves.toEqual([
      { id: 'g-1', name: 'Test Family', role: 'Family member', memberCount: 3, isActive: true },
      { id: 'g-2', name: 'Other Family', role: 'Circle owner', memberCount: 8, isActive: false },
    ])
    expect(circle.getTree).toHaveBeenCalledWith('g-1', '88')
    expect(circle.getTree).toHaveBeenCalledWith('g-2', '88')
  })

  it('selects only a Circle in the protected user membership list', async () => {
    const { service, users } = setup({ activeCircleId: 'g-1' })
    await expect(service.selectCircle('g-2')).resolves.toEqual({ success: true })
    expect(users.setActiveCircleId).toHaveBeenCalledWith(7, 'g-2')

    users.setActiveCircleId.mockClear()
    await expect(service.selectCircle('not-mine')).rejects.toThrow('Circle was not found')
    expect(users.setActiveCircleId).not.toHaveBeenCalled()
  })

  it('rejects create when there is no protected session', async () => {
    const { service, circle } = setup({ sessionUser: null })
    await expect(service.createCircle({ name: 'Kasule Family' })).rejects.toThrow('Please sign in')
    expect(circle.ensureSharedUser).not.toHaveBeenCalled()
    expect(circle.createCircle).not.toHaveBeenCalled()
  })

  it('bootstraps and persists a missing shared identity before creating and selecting the new Circle', async () => {
    const { service, users, circle } = setup({ sessionUser: ownerUser, serverUserId: null })

    await expect(service.createCircle({ name: ' Kasule Family ' })).resolves.toEqual({ circleId: 'circle-1' })
    expect(circle.ensureSharedUser).toHaveBeenCalledWith({
      email: 'owner@example.test',
      name: 'Owner Name',
    })
    expect(users.setServerUserId).toHaveBeenCalledWith(7, '88')
    expect(circle.createCircle).toHaveBeenCalledWith({ serverUserId: '88', name: 'Kasule Family' })
    expect(users.setActiveCircleId).toHaveBeenCalledWith(7, 'circle-1')
  })

  it('keeps a successfully bootstrapped shared identity when Circle creation subsequently fails', async () => {
    const { service, users } = setup({
      sessionUser: ownerUser,
      serverUserId: null,
      createCircleError: new Error('remote create failed'),
    })

    await expect(service.createCircle({ name: 'Kasule Family' })).rejects.toThrow('remote create failed')
    expect(users.setServerUserId).toHaveBeenCalledWith(7, '88')
    expect(users.setActiveCircleId).not.toHaveBeenCalled()
  })

  it('reuses an existing shared identity without registering it again', async () => {
    const { service, circle } = setup({ sessionUser: ownerUser, serverUserId: '88' })
    await service.createCircle({ name: 'Kasule Family' })
    expect(circle.ensureSharedUser).not.toHaveBeenCalled()
    expect(circle.createCircle).toHaveBeenCalledWith({ serverUserId: '88', name: 'Kasule Family' })
  })

  it('allows only the actual Circle owner to invite and validates the fixed family role at runtime', async () => {
    const { service, circle } = setup({ activeCircleId: 'g-2' })

    await expect(service.inviteMember({
      circleId: 'g-1',
      email: 'relative@example.test',
      role: 'Sibling',
    })).rejects.toThrow('Only the Circle owner can invite members')
    expect(circle.inviteMember).not.toHaveBeenCalled()

    await expect(service.inviteMember({
      circleId: 'g-2',
      email: 'relative@example.test',
      role: 'Administrator' as 'Sibling',
    })).rejects.toThrow('valid family role')
    expect(circle.inviteMember).not.toHaveBeenCalled()

    await expect(service.inviteMember({
      circleId: 'g-2',
      email: 'relative@example.test',
      role: 'Sibling',
    })).resolves.toEqual({ outcome: 'sent' })
    expect(circle.inviteMember).toHaveBeenCalledWith({
      serverUserId: '88',
      circleId: 'g-2',
      email: 'relative@example.test',
      role: 'Sibling',
    })
  })
})
