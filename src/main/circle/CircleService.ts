import { INVITATION_FAMILY_ROLES } from '../../shared/desktopApi'
import type {
  AuthUser,
  CircleGroupRecord,
  CircleListItem,
  CircleNotificationRecord,
  CircleOverview,
  CircleTreeRecord,
  CreateCircleInput,
  CreateCircleResult,
  InvitationFamilyRole,
  InviteMemberInput,
  InviteMemberResult,
} from '../../shared/desktopApi'
import type { UserRecord } from '../auth/UserRepository'
import type { CircleGroupInternal, CircleTreeInternal } from './circleModels'

export type {
  CircleGroupRecord,
  CircleListItem,
  CircleNotificationRecord,
  CircleOverview,
  CircleTreePersonRecord,
  CircleTreePositionRecord,
  CircleTreeRecord,
  CircleTreeRelationRecord,
  CreateCircleInput,
  CreateCircleResult,
  InvitationFamilyRole,
  InviteMemberInput,
  InviteMemberResult,
} from '../../shared/desktopApi'

export interface CircleSessionSource {
  restore(): Promise<AuthUser | null>
}

export interface CircleUserSource {
  getRecordById(id: number): Promise<UserRecord | null>
  setServerUserId(userId: number, serverUserId: string): Promise<void>
  setActiveCircleId(userId: number, circleId: string | null): Promise<void>
}

export interface CirclePort {
  listGroups(serverUserId: string): Promise<CircleGroupInternal[]>
  getTree(groupId: string, serverUserId: string): Promise<CircleTreeInternal>
  getNotifications(serverUserId: string): Promise<CircleNotificationRecord[]>
  ensureSharedUser(input: { email: string; name: string }): Promise<{ serverUserId: string }>
  createCircle(input: { serverUserId: string; name: string }): Promise<CircleGroupInternal>
  inviteMember(input: {
    serverUserId: string
    circleId: string
    email: string
    role: InvitationFamilyRole
  }): Promise<InviteMemberResult>
}

function emptyOverview(
  reason: 'not-linked' | 'no-circles',
  notifications: CircleNotificationRecord[] = [],
): CircleOverview {
  return {
    status: 'empty',
    reason,
    circles: [],
    activeCircleId: null,
    viewerPersonId: null,
    tree: null,
    notifications,
  }
}

function safeGroup(group: CircleGroupInternal): CircleGroupRecord {
  return {
    id: group.id,
    name: group.name,
    role: group.role,
  }
}

function safeTree(tree: CircleTreeInternal): CircleTreeRecord {
  return {
    group: {
      id: tree.group.id,
      name: tree.group.name,
    },
    people: tree.people.map((person) => ({
      id: person.id,
      kind: person.kind,
      name: person.name,
      email: person.email,
      role: person.role,
    })),
    relations: tree.relations.map((relation) => ({
      id: relation.id,
      kind: relation.kind,
      aPersonId: relation.aPersonId,
      bPersonId: relation.bPersonId,
    })),
    positions: tree.positions.map((position) => ({
      personId: position.personId,
      x: position.x,
      y: position.y,
    })),
  }
}

export class CircleService {
  constructor(
    private readonly sessions: CircleSessionSource,
    private readonly users: CircleUserSource,
    private readonly circle: CirclePort,
  ) {}

  async getOverview(): Promise<CircleOverview> {
    const record = await this.requireCurrentRecord()
    const serverUserId = String(record.serverUserId ?? '').trim()
    if (!serverUserId) return emptyOverview('not-linked')

    const [groups, notifications] = await Promise.all([
      this.circle.listGroups(serverUserId),
      this.circle.getNotifications(serverUserId),
    ])

    if (groups.length === 0) {
      if (record.activeCircleId) await this.users.setActiveCircleId(record.user.id, null)
      return emptyOverview('no-circles', notifications)
    }

    const activeCircle = await this.resolveActiveCircle(record, groups)
    const tree = await this.circle.getTree(activeCircle.id, serverUserId)
    const viewerPersonId = tree.people.find((person) => person.userId === serverUserId)?.id ?? null

    return {
      status: 'ready',
      circles: groups.map(safeGroup),
      activeCircleId: activeCircle.id,
      viewerPersonId,
      tree: safeTree(tree),
      notifications,
    }
  }

  async getMyCircles(): Promise<CircleListItem[]> {
    const record = await this.requireCurrentRecord()
    const serverUserId = String(record.serverUserId ?? '').trim()
    if (!serverUserId) {
      if (record.activeCircleId) await this.users.setActiveCircleId(record.user.id, null)
      return []
    }

    const groups = await this.circle.listGroups(serverUserId)
    if (groups.length === 0) {
      if (record.activeCircleId) await this.users.setActiveCircleId(record.user.id, null)
      return []
    }

    const activeCircle = await this.resolveActiveCircle(record, groups)
    const trees = await Promise.all(groups.map((group) => this.circle.getTree(group.id, serverUserId)))

    return groups.map((group, index) => ({
      id: group.id,
      name: group.name,
      role: group.role,
      memberCount: trees[index].people.filter((person) => person.kind === 'user').length,
      isActive: group.id === activeCircle.id,
    }))
  }

  async selectCircle(circleIdInput: string): Promise<{ success: true }> {
    const record = await this.requireCurrentRecord()
    const serverUserId = String(record.serverUserId ?? '').trim()
    if (!serverUserId) throw new Error('Circle was not found')

    const circleId = String(circleIdInput ?? '').trim()
    const groups = await this.circle.listGroups(serverUserId)
    if (!circleId || !groups.some((group) => group.id === circleId)) {
      throw new Error('Circle was not found')
    }

    await this.users.setActiveCircleId(record.user.id, circleId)
    return { success: true }
  }

  async createCircle(input: CreateCircleInput): Promise<CreateCircleResult> {
    const record = await this.requireCurrentRecord()
    const name = String(input.name ?? '').trim()
    if (!name) throw new Error('Circle name is required')
    if (name.length > 120) throw new Error('Circle name is too long')

    let serverUserId = String(record.serverUserId ?? '').trim()
    if (!serverUserId) {
      const shared = await this.circle.ensureSharedUser({
        email: record.user.email,
        name: String(record.user.name ?? '').trim() || record.user.email,
      })
      serverUserId = String(shared.serverUserId ?? '').trim()
      if (!serverUserId) throw new Error('The shared account could not be created')
      await this.users.setServerUserId(record.user.id, serverUserId)
    }

    const created = await this.circle.createCircle({ serverUserId, name })
    await this.users.setActiveCircleId(record.user.id, created.id)
    return { circleId: created.id }
  }

  async inviteMember(input: InviteMemberInput): Promise<InviteMemberResult> {
    const record = await this.requireCurrentRecord()
    const allowedRoles = INVITATION_FAMILY_ROLES as readonly string[]
    if (!allowedRoles.includes(String(input.role))) throw new Error('Choose a valid family role')

    const email = String(input.email ?? '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Enter a valid email address')
    }

    const serverUserId = String(record.serverUserId ?? '').trim()
    if (!serverUserId) throw new Error('Only the Circle owner can invite members')

    const circleId = String(input.circleId ?? '').trim()
    const groups = await this.circle.listGroups(serverUserId)
    const group = groups.find((candidate) => candidate.id === circleId)
    if (!group || group.ownerId !== serverUserId) {
      throw new Error('Only the Circle owner can invite members')
    }

    return this.circle.inviteMember({
      serverUserId,
      circleId,
      email,
      role: input.role,
    })
  }

  private async requireCurrentRecord(): Promise<UserRecord> {
    const current = await this.sessions.restore()
    if (!current) throw new Error('Please sign in to manage your family circles')
    const record = await this.users.getRecordById(current.id)
    if (!record) throw new Error('Please sign in again to manage your family circles')
    return record
  }

  private async resolveActiveCircle(
    record: UserRecord,
    groups: CircleGroupInternal[],
  ): Promise<CircleGroupInternal> {
    const activeCircle = groups.find((group) => group.id === record.activeCircleId)
      ?? groups.find((group) => group.id === record.invitation?.groupId)
      ?? groups[0]

    if (record.activeCircleId && record.activeCircleId !== activeCircle.id) {
      await this.users.setActiveCircleId(record.user.id, activeCircle.id)
    }
    return activeCircle
  }
}
