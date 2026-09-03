import type {
  CircleGroupRecord,
  CircleNotificationRecord,
  CircleOverview,
  CircleTreePersonRecord,
  CircleTreePositionRecord,
} from '../../../shared/desktopApi'
import type { CircleClient } from './CircleClient'
import type { ActivityItem, CircleSummary, HomeSnapshot, ShellSnapshot } from './types'

type GetOverview = () => Promise<CircleOverview>

function defaultOverview(): Promise<CircleOverview> {
  return window.familyCircle.circle.getOverview()
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function personKind(kind: CircleTreePersonRecord['kind']): 'member' | 'placeholder' | 'invited' {
  if (kind === 'invite') return 'invited'
  if (kind === 'placeholder') return 'placeholder'
  return 'member'
}

function generationMap(positions: CircleTreePositionRecord[]): Map<string, number> {
  const finite = positions.filter((position) => Number.isFinite(position.y))
  if (finite.length === 0) return new Map()
  const values = finite.map((position) => position.y)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  return new Map(finite.map((position) => [
    position.personId,
    range === 0 ? 1 : Math.max(0, Math.min(2, Math.round(((position.y - min) / range) * 2))),
  ]))
}

function relativeTime(createdAt: number | null, now: number): string {
  if (createdAt == null || !Number.isFinite(createdAt)) return 'Recently'
  const elapsed = Math.max(0, now - createdAt)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function activityKind(type: string): ActivityItem['kind'] {
  const normalized = type.toLowerCase()
  if (normalized.includes('invite') || normalized.includes('member_')) return 'invitation'
  if (normalized.includes('relation')) return 'relationship'
  if (normalized.includes('story')) return 'story'
  return 'tree'
}

function mapNotification(notification: CircleNotificationRecord, now: number): ActivityItem {
  return {
    id: notification.id,
    title: notification.title,
    detail: notification.groupName || notification.message || 'Family Circle',
    when: relativeTime(notification.createdAt, now),
    kind: activityKind(notification.type),
  }
}

function mapCircle(circle: CircleGroupRecord, activeCircleId: string, memberCount: number | null): CircleSummary {
  return {
    id: circle.id,
    name: circle.name,
    role: circle.role,
    memberCount,
    isActive: circle.id === activeCircleId,
  }
}

export class DesktopCircleClient implements CircleClient {
  private overviewInFlight: Promise<CircleOverview> | null = null

  constructor(
    private readonly getOverview: GetOverview = defaultOverview,
    private readonly now: () => number = Date.now,
  ) {}

  async getHomeSnapshot(): Promise<HomeSnapshot> {
    const overview = await this.readOverview()
    if (overview.status === 'empty') {
      return { state: 'empty', reason: overview.reason }
    }

    const activeCircle = overview.circles.find((circle) => circle.id === overview.activeCircleId)
    if (!activeCircle) throw new Error('The active family circle is unavailable')

    const generations = generationMap(overview.tree.positions)
    const people = overview.tree.people.map((person) => ({
      id: person.id,
      name: person.name,
      role: person.role,
      ...(person.email ? { email: person.email } : {}),
      initials: initials(person.name),
      kind: personKind(person.kind),
      generation: generations.get(person.id) ?? 1,
    }))
    const memberCount = overview.tree.people.filter((person) => person.kind === 'user').length
    const selectedPersonId = overview.viewerPersonId
      ?? overview.tree.people.find((person) => person.kind === 'user')?.id
      ?? overview.tree.people[0]?.id
      ?? ''

    return {
      state: 'ready',
      activeCircle: {
        id: activeCircle.id,
        name: activeCircle.name,
        role: activeCircle.role,
        memberCount,
        isActive: true,
      },
      metrics: {
        members: memberCount,
        circles: overview.circles.length,
        stories: null,
        memories: null,
      },
      upcoming: [],
      activity: overview.notifications.map((notification) => mapNotification(notification, this.now())),
      people,
      relationships: overview.tree.relations.map((relation) => ({
        id: relation.id,
        fromPersonId: relation.aPersonId,
        toPersonId: relation.bPersonId,
        kind: relation.kind,
      })),
      selectedPersonId,
    }
  }

  async getMyCircles(): Promise<CircleSummary[]> {
    const overview = await this.readOverview()
    if (overview.status === 'empty') return []
    const memberCount = overview.tree.people.filter((person) => person.kind === 'user').length
    return overview.circles.map((circle) => mapCircle(
      circle,
      overview.activeCircleId,
      circle.id === overview.activeCircleId ? memberCount : null,
    ))
  }

  async getShellSnapshot(): Promise<ShellSnapshot> {
    const overview = await this.readOverview()
    if (overview.status === 'empty') {
      return {
        activeCircleName: null,
        unreadNotifications: overview.notifications.filter((notification) => !notification.read).length,
      }
    }

    const activeCircle = overview.circles.find((circle) => circle.id === overview.activeCircleId)
    return {
      activeCircleName: activeCircle?.name ?? overview.tree.group.name ?? null,
      unreadNotifications: overview.notifications.filter((notification) => !notification.read).length,
    }
  }

  private readOverview(): Promise<CircleOverview> {
    if (this.overviewInFlight) return this.overviewInFlight

    const request = this.getOverview()
    this.overviewInFlight = request
    void request.then(
      () => {
        if (this.overviewInFlight === request) this.overviewInFlight = null
      },
      () => {
        if (this.overviewInFlight === request) this.overviewInFlight = null
      },
    )
    return request
  }
}
