import { describe, expect, it, vi } from 'vitest'
import { LegacyCircleAuthAdapter } from './LegacyCircleAuthAdapter'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('LegacyCircleAuthAdapter read model', () => {
  it('normalizes group ownership and keeps Circle owner authoritative over descriptive roles', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      groups: [
        { id: 'g-owner', name: 'Owner Family', ownerId: 88 },
        { id: 'g-owner-role', name: 'Owner With Role', ownerId: 88, role: 'Sibling' },
        { id: 'g-member', name: 'Member Family', ownerId: 1 },
        { id: 'g-role', name: 'Historian Family', ownerId: 1, role: 'Family historian' },
      ],
    }))
    const adapter = new LegacyCircleAuthAdapter({ baseUrl: 'https://circle.example.test', apiKey: 'legacy-key' }, fetcher)

    await expect(adapter.listGroups('88')).resolves.toEqual([
      { id: 'g-owner', name: 'Owner Family', ownerId: '88', role: 'Circle owner' },
      { id: 'g-owner-role', name: 'Owner With Role', ownerId: '88', role: 'Circle owner' },
      { id: 'g-member', name: 'Member Family', ownerId: '1', role: 'Family member' },
      { id: 'g-role', name: 'Historian Family', ownerId: '1', role: 'Family historian' },
    ])
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://circle.example.test/api/me/88/groups')
  })

  it('maps the legacy tree into safe camelCase people, relations, and finite positions', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      group: { id: 'g-1', name: 'Test Family', ownerId: 1 },
      people: [
        { id: 'user:88', kind: 'user', user_id: 88, name: 'Member Example', email: 'member@example.test', role: 'Family member' },
        { id: 'placeholder:p-1', kind: 'placeholder', name: 'Grandmother', email: null, role: 'Grandparent' },
        { id: 'invite:i-1', kind: 'invite', name: 'Pending Cousin', email: 'cousin@example.test', role: 'Family member' },
      ],
      relations: [
        { id: 'r-1', kind: 'sibling', a_person_id: 'user:88', b_person_id: 'placeholder:p-1' },
      ],
      positions: [
        { person_id: 'user:88', x: 120, y: 240 },
        { person_id: 'placeholder:p-1', x: 'bad', y: 300 },
      ],
      invites: [{ id: 'secret-invite-record', token: 'must-not-leak' }],
    }))
    const adapter = new LegacyCircleAuthAdapter({ baseUrl: 'https://circle.example.test', apiKey: 'legacy-key' }, fetcher)

    await expect(adapter.getTree('g-1', '88')).resolves.toEqual({
      group: { id: 'g-1', name: 'Test Family', ownerId: '1' },
      people: [
        { id: 'user:88', kind: 'user', userId: '88', name: 'Member Example', email: 'member@example.test', role: 'Family member' },
        { id: 'placeholder:p-1', kind: 'placeholder', userId: null, name: 'Grandmother', email: null, role: 'Grandparent' },
        { id: 'invite:i-1', kind: 'invite', userId: null, invitationId: null, name: 'Pending Cousin', email: 'cousin@example.test', role: 'Family member' },
      ],
      relations: [{ id: 'r-1', kind: 'sibling', aPersonId: 'user:88', bPersonId: 'placeholder:p-1' }],
      positions: [{ personId: 'user:88', x: 120, y: 240 }],
    })
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://circle.example.test/api/group/g-1/tree/88')
  })

  it('normalizes notifications without exposing extra server fields', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      unreadCount: 1,
      notifications: [
        {
          id: 'n-1',
          type: 'member_joined',
          title: 'A family member joined',
          message: 'Membership changed.',
          groupId: 'g-1',
          groupName: 'Test Family',
          entityId: 'internal-entity',
          createdAt: '1700000000000',
          read: false,
          actionable: true,
          token: 'must-not-leak',
        },
      ],
    }))
    const adapter = new LegacyCircleAuthAdapter({ baseUrl: 'https://circle.example.test', apiKey: 'legacy-key' }, fetcher)

    const notifications = await adapter.getNotifications('88')
    expect(notifications).toEqual([{
      id: 'n-1',
      type: 'member_joined',
      title: 'A family member joined',
      message: 'Membership changed.',
      groupId: 'g-1',
      groupName: 'Test Family',
      createdAt: 1_700_000_000_000,
      read: false,
    }])
    expect(JSON.stringify(notifications)).not.toContain('must-not-leak')
    expect(JSON.stringify(notifications)).not.toContain('internal-entity')
  })
})
