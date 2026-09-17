import { describe, expect, it, vi } from 'vitest'
import { LegacyCircleAuthAdapter } from './LegacyCircleAuthAdapter'

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('LegacyCircleAuthAdapter client invitation delivery', () => {
  it('keeps client-mode delivery material inside the main-process result', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      success: true,
      emailSent: false,
      emailDeliveryRequired: true,
      emailPayload: {
        to: ' Relative@Example.COM ',
        groupName: 'Kasule Family',
        ownerName: 'Owner Example',
        role: 'Sibling',
        token: 'must-stay-in-legacy-response',
        tempPassword: 'Kin-demo-secret!',
      },
    }))
    const adapter = new LegacyCircleAuthAdapter({ baseUrl: 'https://circle.example.test', apiKey: 'legacy-key' }, fetcher)

    const result = await adapter.inviteMember({
      serverUserId: '88',
      circleId: 'g-1',
      email: 'relative@example.com',
      role: 'Sibling',
    })

    expect(result).toEqual({
      outcome: 'sent',
      delivery: {
        to: 'relative@example.com',
        circleName: 'Kasule Family',
        role: 'Sibling',
        temporaryPassword: 'Kin-demo-secret!',
      },
    })
    expect(JSON.stringify(result)).not.toContain('must-stay-in-legacy-response')
  })

  it('preserves pending state while exposing the refreshed client delivery payload', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      alreadyPending: true,
      emailRetried: true,
      emailSent: false,
      emailDeliveryRequired: true,
      emailPayload: {
        to: 'pending@example.test',
        groupName: 'Test Family',
        role: 'Child',
        tempPassword: 'Kin-pending-secret!',
      },
    }))
    const adapter = new LegacyCircleAuthAdapter({ baseUrl: 'https://circle.example.test', apiKey: 'legacy-key' }, fetcher)

    await expect(adapter.inviteMember({
      serverUserId: '88',
      circleId: 'g-1',
      email: 'pending@example.test',
      role: 'Child',
    })).resolves.toEqual({
      outcome: 'already-pending',
      delivery: {
        to: 'pending@example.test',
        circleName: 'Test Family',
        role: 'Child',
        temporaryPassword: 'Kin-pending-secret!',
      },
    })
  })

  it('discards a client delivery payload that targets a different recipient or role', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      success: true,
      emailSent: false,
      emailDeliveryRequired: true,
      emailPayload: {
        to: 'attacker@example.test',
        groupName: 'Kasule Family',
        role: 'Parent',
        tempPassword: 'Kin-must-not-redirect!',
      },
    }))
    const adapter = new LegacyCircleAuthAdapter({ baseUrl: 'https://circle.example.test', apiKey: 'legacy-key' }, fetcher)

    await expect(adapter.inviteMember({
      serverUserId: '88',
      circleId: 'g-1',
      email: 'relative@example.test',
      role: 'Sibling',
    })).resolves.toEqual({ outcome: 'sent' })
  })
})
