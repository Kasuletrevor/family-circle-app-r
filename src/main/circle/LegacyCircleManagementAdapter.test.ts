import { describe, expect, it, vi } from 'vitest'
import { LegacyCircleAuthAdapter } from './LegacyCircleAuthAdapter'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('LegacyCircleAuthAdapter management writes', () => {
  it('cancels, removes, and leaves using only Jose-compatible internal payloads', async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        path: new URL(String(input)).pathname,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return jsonResponse({ success: true })
    })
    const adapter = new LegacyCircleAuthAdapter({ baseUrl: 'https://circle.example.test', apiKey: 'legacy-key' }, fetcher)

    await expect(adapter.cancelInvitation({
      serverUserId: '88',
      circleId: 'g-1',
      invitationId: 'inv-1',
    })).resolves.toEqual({ success: true })
    await expect(adapter.removeMember({
      serverUserId: '88',
      circleId: 'g-1',
      targetServerUserId: '99',
    })).resolves.toEqual({ success: true })
    await expect(adapter.leaveCircle({
      serverUserId: '99',
      circleId: 'g-1',
    })).resolves.toEqual({ success: true })

    expect(calls).toEqual([
      {
        path: '/api/group/g-1/invitation/cancel',
        body: { fromUserId: '88', invitationId: 'inv-1' },
      },
      {
        path: '/api/group/g-1/member/remove',
        body: { fromUserId: '88', userId: '99' },
      },
      {
        path: '/api/group/g-1/leave',
        body: { fromUserId: '99' },
      },
    ])
  })

  it('retains pending invitation identity only in the main-process tree model', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      group: { id: 'g-1', name: 'Test Family', ownerId: '88' },
      people: [
        {
          id: 'invite:inv-1',
          invitation_id: 'inv-1',
          kind: 'invite',
          name: 'relative@example.test',
          email: 'relative@example.test',
          role: 'Sibling',
        },
      ],
      relations: [],
      positions: [],
    }))
    const adapter = new LegacyCircleAuthAdapter({ baseUrl: 'https://circle.example.test', apiKey: 'legacy-key' }, fetcher)

    const tree = await adapter.getTree('g-1', '88')
    expect(tree.people[0]).toMatchObject({
      id: 'invite:inv-1',
      invitationId: 'inv-1',
      kind: 'invite',
      email: 'relative@example.test',
      role: 'Sibling',
    })
  })
})
