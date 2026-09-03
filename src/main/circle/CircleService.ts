import type {
  AuthUser,
  CircleGroupRecord,
  CircleNotificationRecord,
  CircleOverview,
  CircleTreePersonRecord,
  CircleTreePositionRecord,
  CircleTreeRecord,
  CircleTreeRelationRecord,
} from '../../shared/desktopApi'
import type { UserRecord } from '../auth/UserRepository'

export type {
  CircleGroupRecord,
  CircleNotificationRecord,
  CircleOverview,
  CircleTreePersonRecord,
  CircleTreePositionRecord,
  CircleTreeRecord,
  CircleTreeRelationRecord,
} from '../../shared/desktopApi'

export interface CircleSessionSource {
  restore(): Promise<AuthUser | null>
}

export interface CircleUserSource {
  getRecordById(id: number): Promise<UserRecord | null>
}

export interface CircleReadPort {
  listGroups(serverUserId: string): Promise<CircleGroupRecord[]>
  getTree(groupId: string, serverUserId: string): Promise<CircleTreeRecord>
  getNotifications(serverUserId: string): Promise<CircleNotificationRecord[]>
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
    tree: null,
    notifications,
  }
}

export class CircleService {
  constructor(
    private readonly sessions: CircleSessionSource,
    private readonly users: CircleUserSource,
    private readonly circle: CircleReadPort,
  ) {}

  async getOverview(): Promise<CircleOverview> {
    const current = await this.sessions.restore()
    if (!current) throw new Error('Please sign in to load your family circles')

    const record = await this.users.getRecordById(current.id)
    if (!record) throw new Error('Please sign in again to load your family circles')

    const serverUserId = String(record.serverUserId ?? '').trim()
    if (!serverUserId) return emptyOverview('not-linked')

    const [circles, notifications] = await Promise.all([
      this.circle.listGroups(serverUserId),
      this.circle.getNotifications(serverUserId),
    ])

    if (circles.length === 0) return emptyOverview('no-circles', notifications)

    const invitedCircleId = String(record.invitation?.groupId ?? '')
    const activeCircle = circles.find((circle) => circle.id === invitedCircleId) ?? circles[0]
    const tree = await this.circle.getTree(activeCircle.id, serverUserId)

    return {
      status: 'ready',
      circles,
      activeCircleId: activeCircle.id,
      tree,
      notifications,
    }
  }
}
