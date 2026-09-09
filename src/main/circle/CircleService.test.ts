import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import { CircleService } from './CircleService'
import type { CircleTreeInternal } from './circleModels'

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

function treeFor(groupId: string, name: string, ownerId: string, memberCount: number, viewerId = '88'): CircleTreeInternal {
  const people = Array.from({ length: memberCount }, (_, index) => ({
    id: `user:${index === 0 ? viewerId : index + 100}`,
    kind: 'user' as const,
    userId: index === 0 ? viewerId : String(index + 100),
    name: index === 0 ? 'Member Example' : `Family Member ${index}`,
    email: index === 0 ? 'member@example.test' : `member${index}@example.test`,
    role: 'Family member',
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
  trees?: Record<string, CircleTreeInternal>
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
    addTreeRelation: vi.fn(async () => ({ success: true as const })),
    deleteTreeRelation: vi.fn(async () => ({ success: true as const })),
    saveTreePosition: vi.fn(async () => ({ success: true as const })),
    cancelInvitation: vi.fn(async () => ({ success: true as const })),
    removeMember: vi.fn(async () => ({ success: true as const })),
    leaveCircle: vi.fn(async () => ({ success: true as const })),
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
      viewerIsOwner: false,
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
      viewerIsOwner: false,
    })
    expect(circle.getTree).not.toHaveBeenCalled()
    expect(circle.getNotifications).toHaveBeenCalledWith('88')
    expect(users.setActiveCircleId).toHaveBeenCalledWith(7, null)
  })

  it('uses the local active Circle preference, derives owner capability, and strips shared identities', async () => {
    const { service, circle } = setup({ activeCircleId: 'g-2' })
    const overview = await service.getOverview()

    expect(circle.listGroups).toHaveBeenCalledWith('88')
    expect(circle.getTree).toHaveBeenCalledWith('g-2', '88')
    expect(circle.getNotifications).toHaveBeenCalledWith('88')
    expect(overview).toMatchObject({
      status: 'ready',
      activeCircleId: 'g-2',
      viewerPersonId: 'user:88',
      viewerIsOwner: true,
      circles: [
        { id: 'g-1', name: 'Test Family', role: 'Family member' },
        { id: 'g-2', name: 'Other Family', role: 'Circle owner' },
      ],
      tree: {
        group: { id: 'g-2', name: 'Other Family' },
      },
    })
    if (overview.status !== 'ready') throw new Error('Expected a ready Circle overview')
    expect(overview.tree.people).toHaveLength(8)
    expect(overview.tree.people[0]).toMatchObject({
      id: 'user:88',
      kind: 'user',
      name: 'Member Example',
      role: 'Family member',
    })
    expect(JSON.stringify(overview)).not.toContain('ownerId')
    expect(JSON.stringify(overview)).not.toContain('userId')
  })

  it('derives a false owner capability for a non-owner active Circle', async () => {
    const { service } = setup({ activeCircleId: 'g-1' })
    await expect(service.getOverview()).resolves.toMatchObject({
      status: 'ready',
      activeCircleId: 'g-1',
      viewerIsOwner: false,
    })
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

  it('allows only the active Circle owner to add relationships and derives transport identity in main', async () => {
    const member = setup({ activeCircleId: 'g-1' })
    await expect(member.service.addTreeRelation({
      kind: 'sibling',
      aPersonId: 'user:101',
      bPersonId: 'user:102',
    })).rejects.toThrow('Only the Circle owner can manage relationships')
    expect(member.circle.addTreeRelation).not.toHaveBeenCalled()

    const owner = setup({ activeCircleId: 'g-2' })
    await expect(owner.service.addTreeRelation({
      kind: 'sibling',
      aPersonId: 'user:101',
      bPersonId: 'user:102',
    })).resolves.toEqual({ success: true })
    expect(owner.circle.addTreeRelation).toHaveBeenCalledWith({
      serverUserId: '88',
      circleId: 'g-2',
      kind: 'sibling',
      aPersonId: 'user:101',
      bPersonId: 'user:102',
    })
  })

  it('rejects foreign relationship endpoints and ancestry cycles before transport', async () => {
    const owner = setup({ activeCircleId: 'g-2' })
    await expect(owner.service.addTreeRelation({
      kind: 'sibling',
      aPersonId: 'user:101',
      bPersonId: 'user:foreign',
    })).rejects.toThrow('Choose confirmed Circle members')
    expect(owner.circle.addTreeRelation).not.toHaveBeenCalled()

    const cyclicTree = treeFor('g-2', 'Other Family', '88', 3)
    cyclicTree.relations = [
      { id: 'r-1', kind: 'mother', aPersonId: 'user:88', bPersonId: 'user:101' },
      { id: 'r-2', kind: 'father', aPersonId: 'user:101', bPersonId: 'user:102' },
    ]
    const cyclic = setup({ activeCircleId: 'g-2', trees: { 'g-2': cyclicTree } })
    await expect(cyclic.service.addTreeRelation({
      kind: 'guardian',
      aPersonId: 'user:102',
      bPersonId: 'user:88',
    })).rejects.toThrow('That relationship would create an ancestry loop')
    expect(cyclic.circle.addTreeRelation).not.toHaveBeenCalled()
  })

  it('deletes only an authoritative relationship from the active owned Circle', async () => {
    const owner = setup({ activeCircleId: 'g-2' })

    await expect(owner.service.deleteTreeRelation({ relationId: 'missing-r' }))
      .rejects.toThrow('That relationship is no longer in this Circle')
    expect(owner.circle.deleteTreeRelation).not.toHaveBeenCalled()

    await expect(owner.service.deleteTreeRelation({ relationId: 'g-2-r-1' }))
      .resolves.toEqual({ success: true })
    expect(owner.circle.deleteTreeRelation).toHaveBeenCalledWith({
      serverUserId: '88',
      circleId: 'g-2',
      relationId: 'g-2-r-1',
    })
  })

  it('allows members to move only their own confirmed card and owners to move any confirmed member', async () => {
    const member = setup({ activeCircleId: 'g-1' })
    await expect(member.service.saveTreePosition({ personId: 'user:88', x: 50, y: 75 }))
      .resolves.toEqual({ success: true })
    expect(member.circle.saveTreePosition).toHaveBeenCalledWith({
      serverUserId: '88',
      circleId: 'g-1',
      personId: 'user:88',
      x: 50,
      y: 75,
    })

    member.circle.saveTreePosition.mockClear()
    await expect(member.service.saveTreePosition({ personId: 'user:101', x: 50, y: 75 }))
      .rejects.toThrow('You can only move your own family tree card')
    expect(member.circle.saveTreePosition).not.toHaveBeenCalled()

    const owner = setup({ activeCircleId: 'g-2' })
    await expect(owner.service.saveTreePosition({ personId: 'user:101', x: 50, y: 75 }))
      .resolves.toEqual({ success: true })
    expect(owner.circle.saveTreePosition).toHaveBeenCalledWith({
      serverUserId: '88',
      circleId: 'g-2',
      personId: 'user:101',
      x: 50,
      y: 75,
    })
  })

  it('rejects placeholder movement and invalid coordinates before transport', async () => {
    const ownerTree = treeFor('g-2', 'Other Family', '88', 3)
    ownerTree.people.push({
      id: 'placeholder:p1',
      kind: 'placeholder',
      userId: null,
      name: 'Legacy Relative',
      email: null,
      role: '',
    })
    const owner = setup({ activeCircleId: 'g-2', trees: { 'g-2': ownerTree } })

    await expect(owner.service.saveTreePosition({ personId: 'placeholder:p1', x: 10, y: 20 }))
      .rejects.toThrow()
    expect(owner.circle.saveTreePosition).not.toHaveBeenCalled()

    await expect(owner.service.saveTreePosition({ personId: 'user:101', x: 100001, y: 0 }))
      .rejects.toThrow('Choose a valid tree position')
    expect(owner.circle.saveTreePosition).not.toHaveBeenCalled()
  })
})
