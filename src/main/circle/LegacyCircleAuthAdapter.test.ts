import { describe, expect, it, vi } from 'vitest'
import { LegacyCircleAuthAdapter } from './LegacyCircleAuthAdapter'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('LegacyCircleAuthAdapter', () => {
  it('returns a safe invitation summary and keeps the shared key inside request headers', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('X-Kin-Keepers-Key')).toBe('legacy-key')
      return jsonResponse({
        hasPendingInvite: true,
        groupName: 'Kasule Family',
        role: 'Family member',
        tempPassword: 'temporary secret',
        token: 'invite-token',
      })
    })
    const adapter = new LegacyCircleAuthAdapter({ baseUrl: 'https://circle.example.test', apiKey: 'legacy-key' }, fetcher)

    await expect(adapter.checkInvitation(' Trevor@Example.COM ')).resolves.toEqual({
      hasPendingInvite: true,
      groupName: 'Kasule Family',
      role: 'Family member',
    })
    expect(JSON.stringify(await adapter.checkInvitation('trevor@example.com'))).not.toContain('temporary secret')
    expect(JSON.stringify(await adapter.checkInvitation('trevor@example.com'))).not.toContain('invite-token')
  })

  it('rejects a wrong temporary invitation password before making claim writes', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      hasPendingInvite: true,
      groupId: 'g-1',
      groupName: 'Kasule Family',
      role: 'Family member',
      tempPassword: 'correct temporary password',
      token: 'invite-token',
      serverId: 42,
    }))
    const adapter = new LegacyCircleAuthAdapter({ baseUrl: 'https://circle.example.test', apiKey: 'legacy-key' }, fetcher)

    await expect(adapter.claimInvitation({
      email: 'trevor@example.com',
      enteredPassword: 'wrong temporary password',
    })).rejects.toThrow('Incorrect password')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('performs the complete claim sequence and confirms the invited membership', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ url, method, body })

      if (url.includes('/api/invitation-check')) return jsonResponse({
        hasPendingInvite: true,
        groupId: 'g-1',
        groupName: 'Kasule Family',
        role: 'Family member',
        tempPassword: 'temporary password 123',
        token: 'invite-token',
      })
      if (url.endsWith('/api/register')) return jsonResponse({ user: { id: 42, name: 'Trevor Kasule' } })
      if (url.endsWith('/api/invitations/accept-link')) return jsonResponse({ success: true })
      if (url.endsWith('/api/user/mark-claimed')) return jsonResponse({ groupsClaimed: 1 })
      if (url.endsWith('/api/me/42/groups')) return jsonResponse({
        groups: [{ id: 'g-1', name: 'Kasule Family', role: 'Family member' }],
      })
      return jsonResponse({ error: 'unexpected' }, 404)
    })
    const adapter = new LegacyCircleAuthAdapter({ baseUrl: 'https://circle.example.test/', apiKey: 'legacy-key' }, fetcher)

    await expect(adapter.claimInvitation({
      email: ' Trevor@Example.COM ',
      enteredPassword: 'temporary password 123',
    })).resolves.toEqual({
      email: 'trevor@example.com',
      name: 'Trevor Kasule',
      serverUserId: '42',
      verifiedTemporaryPassword: 'temporary password 123',
      invitation: { groupId: 'g-1', groupName: 'Kasule Family', role: 'Family member' },
    })

    expect(calls.map(({ url, method }) => [method, new URL(url).pathname])).toEqual([
      ['GET', '/api/invitation-check'],
      ['POST', '/api/register'],
      ['POST', '/api/invitations/accept-link'],
      ['POST', '/api/user/mark-claimed'],
      ['GET', '/api/me/42/groups'],
    ])
    expect(calls[2].body).toEqual({ token: 'invite-token' })
  })

  it('refuses to finish a claim when the expected invited circle is absent', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/api/invitation-check')) return jsonResponse({
        hasPendingInvite: true,
        groupId: 'g-1',
        groupName: 'Kasule Family',
        role: 'Family member',
        tempPassword: 'temporary password 123',
        token: 'invite-token',
        serverId: 42,
      })
      if (url.endsWith('/api/register')) return jsonResponse({ user: { id: 42, name: 'Trevor' } })
      if (url.endsWith('/api/invitations/accept-link')) return jsonResponse({ success: true })
      if (url.endsWith('/api/user/mark-claimed')) return jsonResponse({ groupsClaimed: 1 })
      if (url.endsWith('/api/me/42/groups')) return jsonResponse({ groups: [] })
      return jsonResponse({}, 404)
    })
    const adapter = new LegacyCircleAuthAdapter({ baseUrl: 'https://circle.example.test', apiKey: 'legacy-key' }, fetcher)

    await expect(adapter.claimInvitation({
      email: 'trevor@example.com',
      enteredPassword: 'temporary password 123',
    })).rejects.toThrow('circle membership could not be confirmed')
  })

  it('aborts slow requests using the configured timeout', async () => {
    const fetcher = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const adapter = new LegacyCircleAuthAdapter({
      baseUrl: 'https://circle.example.test',
      apiKey: 'legacy-key',
      timeoutMs: 5,
    }, fetcher)

    await expect(adapter.checkInvitation('trevor@example.com')).rejects.toThrow('Circle service request timed out')
  })
})
