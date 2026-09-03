import type { InvitationCheckResult } from '../../shared/desktopApi'
import { normalizeEmail } from '../auth/passwordPolicy'
import type {
  CircleGroupRecord,
  CircleNotificationRecord,
  CircleTreePersonRecord,
  CircleTreeRecord,
  CircleTreeRelationRecord,
} from './CircleService'

const DEFAULT_LEGACY_CIRCLE_URL = 'https://familycircle.o2gventures.com/circle-api'

export interface ClaimedInvitation {
  email: string
  name: string
  serverUserId: string
  verifiedTemporaryPassword: string
  invitation: { groupId: string; groupName: string; role: string }
}

export interface LegacyCircleAuthAdapterConfig {
  baseUrl: string
  apiKey: string
  timeoutMs?: number
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface RawInvitation {
  hasPendingInvite?: boolean
  groupId?: string | number | null
  groupName?: string | null
  role?: string | null
  tempPassword?: string | null
  token?: string | null
  serverId?: string | number | null
}

interface RegistrationResponse {
  user?: { id?: string | number | null; name?: string | null }
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null
  const normalized = String(value).trim()
  return normalized || null
}

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizePersonKind(value: unknown, id: string): CircleTreePersonRecord['kind'] {
  const kind = String(value ?? '').trim().toLowerCase()
  if (kind === 'placeholder') return 'placeholder'
  if (kind === 'invite' || id.startsWith('invite:')) return 'invite'
  return 'user'
}

export class LegacyCircleAuthAdapter {
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(
    private readonly config: LegacyCircleAuthAdapterConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.baseUrl = String(config.baseUrl || DEFAULT_LEGACY_CIRCLE_URL).replace(/\/+$/, '')
    this.timeoutMs = config.timeoutMs ?? 12_000
  }

  async checkInvitation(emailInput: string): Promise<InvitationCheckResult> {
    const raw = await this.fetchInvitation(normalizeEmail(emailInput))
    return {
      hasPendingInvite: Boolean(raw.hasPendingInvite),
      groupName: raw.groupName ? String(raw.groupName) : null,
      role: raw.role ? String(raw.role) : null,
    }
  }

  async claimInvitation(input: { email: string; enteredPassword: string }): Promise<ClaimedInvitation> {
    const email = normalizeEmail(input.email)
    const invitation = await this.fetchInvitation(email)
    if (!invitation.hasPendingInvite) {
      throw new Error('No pending family invitation was found for this email')
    }

    const temporaryPassword = String(invitation.tempPassword ?? '').trim()
    if (!temporaryPassword) {
      throw new Error('Could not retrieve your invitation password. Please contact the Circle owner.')
    }
    if (String(input.enteredPassword ?? '').trim() !== temporaryPassword) {
      throw new Error('Incorrect password. Please use the password from your invitation email.')
    }

    const registration = await this.postJson<RegistrationResponse>('/api/register', {
      email,
      name: email,
    })
    const serverUserIdValue = invitation.serverId ?? registration.user?.id
    if (serverUserIdValue == null || String(serverUserIdValue).trim() === '') {
      throw new Error('The shared account could not be created')
    }
    const serverUserId = String(serverUserIdValue)
    const name = String(registration.user?.name || email.split('@')[0])

    const invitationToken = String(invitation.token ?? '').trim()
    if (invitationToken) {
      await this.postJson('/api/invitations/accept-link', { token: invitationToken })
    }

    const claimed = await this.postJson<{ groupsClaimed?: number }>('/api/user/mark-claimed', {
      serverUserId,
      email,
      name,
    })
    if (Number(claimed.groupsClaimed ?? 0) < 1) {
      throw new Error('The invitation was found but its circle membership could not be confirmed')
    }

    const groupId = String(invitation.groupId ?? '').trim()
    if (!groupId) throw new Error('The invitation is missing its family circle')
    const memberships = await this.getMemberships(serverUserId)
    const expectedMembership = memberships.find((membership) => String(membership.id) === groupId)
    if (!expectedMembership) {
      throw new Error('The invitation was found but its circle membership could not be confirmed')
    }

    return {
      email,
      name,
      serverUserId,
      verifiedTemporaryPassword: temporaryPassword,
      invitation: {
        groupId,
        groupName: String(invitation.groupName || expectedMembership.name || 'Family Circle'),
        role: String(invitation.role || expectedMembership.role || 'Family member'),
      },
    }
  }

  async getMemberships(serverUserId: string): Promise<Array<{ id: string; name: string; role: string }>> {
    const groups = await this.listGroups(serverUserId)
    return groups.map(({ id, name, role }) => ({ id, name, role }))
  }

  async listGroups(serverUserId: string): Promise<CircleGroupRecord[]> {
    const safeServerUserId = String(serverUserId).trim()
    const data = await this.getJson<{
      groups?: Array<{ id?: unknown; name?: unknown; ownerId?: unknown; owner_id?: unknown; role?: unknown }>
    }>(`/api/me/${encodeURIComponent(safeServerUserId)}/groups`)

    return Array.isArray(data.groups)
      ? data.groups.map((group) => {
          const id = String(group.id ?? '').trim()
          const ownerId = String(group.ownerId ?? group.owner_id ?? '').trim()
          const explicitRole = String(group.role ?? '').trim()
          return {
            id,
            name: String(group.name ?? 'Family Circle'),
            ownerId,
            role: explicitRole || (ownerId && ownerId === safeServerUserId ? 'Circle owner' : 'Family member'),
          }
        }).filter((group) => Boolean(group.id))
      : []
  }

  async getTree(groupId: string, serverUserId: string): Promise<CircleTreeRecord> {
    const data = await this.getJson<{
      group?: { id?: unknown; name?: unknown; ownerId?: unknown; owner_id?: unknown }
      people?: Array<Record<string, unknown>>
      relations?: Array<Record<string, unknown>>
      positions?: Array<Record<string, unknown>>
    }>(`/api/group/${encodeURIComponent(groupId)}/tree/${encodeURIComponent(serverUserId)}`)

    const group = data.group ?? {}
    const people: CircleTreePersonRecord[] = Array.isArray(data.people)
      ? data.people.map((person) => {
          const id = String(person.id ?? '').trim()
          return {
            id,
            kind: normalizePersonKind(person.kind, id),
            userId: stringOrNull(person.userId ?? person.user_id),
            name: String(person.name ?? person.email ?? 'Family member'),
            email: stringOrNull(person.email),
            role: String(person.role ?? 'Family member'),
          }
        }).filter((person) => Boolean(person.id))
      : []

    const relations: CircleTreeRelationRecord[] = Array.isArray(data.relations)
      ? data.relations.map((relation) => ({
          id: String(relation.id ?? '').trim(),
          kind: String(relation.kind ?? '').trim(),
          aPersonId: String(relation.aPersonId ?? relation.a_person_id ?? '').trim(),
          bPersonId: String(relation.bPersonId ?? relation.b_person_id ?? '').trim(),
        })).filter((relation) => Boolean(relation.id && relation.aPersonId && relation.bPersonId))
      : []

    const positions = Array.isArray(data.positions)
      ? data.positions.flatMap((position) => {
          const personId = String(position.personId ?? position.person_id ?? '').trim()
          const x = finiteNumber(position.x)
          const y = finiteNumber(position.y)
          return personId && x != null && y != null ? [{ personId, x, y }] : []
        })
      : []

    return {
      group: {
        id: String(group.id ?? groupId),
        name: String(group.name ?? 'Family Circle'),
        ownerId: String(group.ownerId ?? group.owner_id ?? ''),
      },
      people,
      relations,
      positions,
    }
  }

  async getNotifications(serverUserId: string): Promise<CircleNotificationRecord[]> {
    const data = await this.getJson<{ notifications?: Array<Record<string, unknown>> }>(
      `/api/me/${encodeURIComponent(serverUserId)}/notifications`,
    )
    return Array.isArray(data.notifications)
      ? data.notifications.map((notification) => ({
          id: String(notification.id ?? '').trim(),
          type: String(notification.type ?? 'circle_activity'),
          title: String(notification.title ?? 'Circle update'),
          message: String(notification.message ?? ''),
          groupId: stringOrNull(notification.groupId ?? notification.group_id),
          groupName: stringOrNull(notification.groupName ?? notification.group_name),
          createdAt: finiteNumber(notification.createdAt ?? notification.created_at),
          read: Boolean(notification.read ?? notification.read_at),
        })).filter((notification) => Boolean(notification.id))
      : []
  }

  private fetchInvitation(email: string): Promise<RawInvitation> {
    return this.getJson(`/api/invitation-check?email=${encodeURIComponent(email)}`)
  }

  private getJson<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' })
  }

  private postJson<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers)
    if (this.config.apiKey) headers.set('X-Kin-Keepers-Key', this.config.apiKey)
    const signal = AbortSignal.timeout(this.timeoutMs)

    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal,
      })
      let data: unknown = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) {
        const message = data && typeof data === 'object' && 'error' in data
          ? String((data as { error?: unknown }).error || '')
          : ''
        throw new Error(message || `Circle service returned ${response.status}`)
      }
      return (data ?? {}) as T
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new Error('Circle service request timed out')
      }
      throw error
    }
  }
}
