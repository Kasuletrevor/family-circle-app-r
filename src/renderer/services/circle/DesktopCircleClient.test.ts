import { describe, expect, it, vi } from 'vitest'
import type { CircleListItem, CircleOverview } from '../../../shared/desktopApi'
import { DesktopCircleClient } from './DesktopCircleClient'

const now = 1_700_000_120_000

const readyOverview: CircleOverview = {
  status: 'ready',
  activeCircleId: 'g-1',
  viewerPersonId: 'user:88',
  circles: [
    { id: 'g-1', name: 'Test Family', role: 'Family member' },
    { id: 'g-2', name: 'Other Family', role: 'Circle owner' },
  ],
  tree: {
    group: { id: 'g-1', name: 'Test Family' },
    people: [
      { id: 'user:1', kind: 'user', name: 'Circle Owner', email: 'owner@example.test', role: 'Circle owner' },
      { id: 'user:88', kind: 'user', name: 'Member Example', email: 'member@example.test', role: 'Family member' },
      { id: 'invite:i-1', kind: 'invite', name: 'Pending Cousin', email: 'cousin@example.test', role: 'Family member' },
    ],
    relations: [{ id: 'r-1', kind: 'sibling', aPersonId: 'user:1', bPersonId: 'user:88' }],
    positions: [
      { personId: 'user:1', x: 10, y: 100 },
      { personId: 'user:88', x: 20, y: 300 },
    ],
  },
  notifications: [
    {
      id: 'n-1',
      type: 'member_joined',
      title: 'A family member joined Test Family',
      message: 'The circle membership was updated.',
      groupId: 'g-1',
      groupName: 'Test Family',
      createdAt: now - 120_000,
      read: false,
    },
  ],
}

const circleList: CircleListItem[] = [
  { id: 'g-1', name: 'Test Family', role: 'Family member', memberCount: 3, isActive: true },
  { id: 'g-2', name: 'Other Family', role: 'Circle owner', memberCount: 8, isActive: false },
]

describe('DesktopCircleClient', () => {
  it('maps the protected desktop overview into real Home data without shared service identities or fabricated local features', async () => {
    const getOverview = vi.fn(async () => readyOverview)
    const client = new DesktopCircleClient(getOverview, () => now)

    await expect(client.getHomeSnapshot()).resolves.toEqual({
      state: 'ready',
      activeCircle: {
        id: 'g-1',
        name: 'Test Family',
        role: 'Family member',
        memberCount: 2,
        isActive: true,
      },
      metrics: { members: 2, circles: 2, stories: null, memories: null },
      upcoming: [],
      activity: [{
        id: 'n-1',
        title: 'A family member joined Test Family',
        detail: 'Test Family',
        when: '2 minutes ago',
        kind: 'invitation',
      }],
      people: [
        {
          id: 'user:1',
          name: 'Circle Owner',
          role: 'Circle owner',
          email: 'owner@example.test',
          initials: 'CO',
          kind: 'member',
          generation: 0,
        },
        {
          id: 'user:88',
          name: 'Member Example',
          role: 'Family member',
          email: 'member@example.test',
          initials: 'ME',
          kind: 'member',
          generation: 2,
        },
        {
          id: 'invite:i-1',
          name: 'Pending Cousin',
          role: 'Family member',
          email: 'cousin@example.test',
          initials: 'PC',
          kind: 'invited',
          generation: 1,
        },
      ],
      relationships: [{
        id: 'r-1',
        fromPersonId: 'user:1',
        toPersonId: 'user:88',
        kind: 'sibling',
      }],
      selectedPersonId: 'user:88',
    })
    expect(getOverview).toHaveBeenCalledTimes(1)
  })

  it('uses the authoritative protected Circle list instead of deriving other Circle counts from the active tree', async () => {
    const getMyCircles = vi.fn(async () => circleList)
    const client = new DesktopCircleClient(async () => readyOverview, () => now, { getMyCircles })

    await expect(client.getMyCircles()).resolves.toEqual([
      { id: 'g-1', name: 'Test Family', role: 'Family member', memberCount: 3, isActive: true },
      { id: 'g-2', name: 'Other Family', role: 'Circle owner', memberCount: 8, isActive: false },
    ])
    expect(getMyCircles).toHaveBeenCalledTimes(1)
  })

  it('returns an explicit Home empty state for an account with no shared Circle', async () => {
    const overview: CircleOverview = {
      status: 'empty',
      reason: 'no-circles',
      circles: [],
      activeCircleId: null,
      viewerPersonId: null,
      tree: null,
      notifications: [],
    }
    const client = new DesktopCircleClient(async () => overview, () => now, { getMyCircles: async () => [] })

    await expect(client.getHomeSnapshot()).resolves.toEqual({
      state: 'empty',
      reason: 'no-circles',
    })
    await expect(client.getMyCircles()).resolves.toEqual([])
    await expect(client.getShellSnapshot()).resolves.toEqual({
      activeCircleName: null,
      unreadNotifications: 0,
    })
  })

  it('maps shell chrome and shares one in-flight overview request across simultaneous consumers', async () => {
    let resolveOverview!: (overview: CircleOverview) => void
    const overviewPromise = new Promise<CircleOverview>((resolve) => { resolveOverview = resolve })
    const getOverview = vi.fn(() => overviewPromise)
    const client = new DesktopCircleClient(getOverview, () => now)

    const home = client.getHomeSnapshot()
    const shell = client.getShellSnapshot()
    resolveOverview(readyOverview)

    await expect(shell).resolves.toEqual({
      activeCircleName: 'Test Family',
      unreadNotifications: 1,
    })
    await expect(home).resolves.toMatchObject({ state: 'ready' })
    expect(getOverview).toHaveBeenCalledTimes(1)
  })

  it('delegates select/create/invite through preload and invalidates an in-flight overview after each confirmed change', async () => {
    const pendingResolvers: Array<(overview: CircleOverview) => void> = []
    const getOverview = vi.fn(() => new Promise<CircleOverview>((resolve) => pendingResolvers.push(resolve)))
    const selectCircle = vi.fn(async () => ({ success: true as const }))
    const createCircle = vi.fn(async () => ({ circleId: 'g-3' }))
    const inviteMember = vi.fn(async () => ({ outcome: 'sent' as const }))
    const client = new DesktopCircleClient(getOverview, () => now, {
      getMyCircles: async () => circleList,
      selectCircle,
      createCircle,
      inviteMember,
    })

    const firstHome = client.getHomeSnapshot()
    expect(getOverview).toHaveBeenCalledTimes(1)

    await client.selectCircle('g-2')
    expect(selectCircle).toHaveBeenCalledWith('g-2')
    const afterSelect = client.getShellSnapshot()
    expect(getOverview).toHaveBeenCalledTimes(2)

    await expect(client.createCircle({ name: 'New Family' })).resolves.toEqual({ circleId: 'g-3' })
    expect(createCircle).toHaveBeenCalledWith({ name: 'New Family' })
    const afterCreate = client.getShellSnapshot()
    expect(getOverview).toHaveBeenCalledTimes(3)

    await expect(client.inviteMember({ circleId: 'g-2', email: 'relative@example.test', role: 'Sibling' }))
      .resolves.toEqual({ outcome: 'sent' })
    expect(inviteMember).toHaveBeenCalledWith({ circleId: 'g-2', email: 'relative@example.test', role: 'Sibling' })
    const afterInvite = client.getShellSnapshot()
    expect(getOverview).toHaveBeenCalledTimes(4)

    pendingResolvers.forEach((resolve) => resolve(readyOverview))
    await Promise.all([firstHome, afterSelect, afterCreate, afterInvite])
  })
})
