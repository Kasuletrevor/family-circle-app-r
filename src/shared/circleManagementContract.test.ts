import { describe, expect, it } from 'vitest'
import type { CircleDetails, CircleDetailsInvitation, CircleDetailsMember, ResendInvitationResult } from './desktopApi'

describe('Circle management public contract', () => {
  it('contains only safe member and invitation fields', () => {
    const member: CircleDetailsMember = {
      personId: 'person-1',
      name: 'John Family',
      email: 'john@example.test',
      role: 'Sibling',
      isViewer: false,
      isOwner: false,
    }
    const invitation: CircleDetailsInvitation = {
      personId: 'invite:inv-1',
      email: 'mary@example.test',
      role: 'Parent',
      status: 'pending',
    }
    const details: CircleDetails = {
      circle: {
        id: 'g-1',
        name: 'Test Family',
        role: 'Circle owner',
        memberCount: 1,
        pendingInvitationCount: 1,
      },
      members: [member],
      invitations: [invitation],
    }
    const resend: ResendInvitationResult = { outcome: 'sent' }

    const serialized = JSON.stringify({ details, resend })
    expect(serialized).not.toContain('serverUserId')
    expect(serialized).not.toContain('fromUserId')
    expect(serialized).not.toContain('ownerId')
    expect(serialized).not.toContain('userId')
    expect(serialized).not.toContain('invitationId')
    expect(serialized).not.toContain('token')
    expect(serialized).not.toContain('tempPassword')
  })
})
