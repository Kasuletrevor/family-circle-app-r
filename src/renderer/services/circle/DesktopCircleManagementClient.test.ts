import { describe, expect, it, vi } from 'vitest'
import type { CircleDetails, CircleOverview } from '../../../shared/desktopApi'
import { DesktopCircleClient } from './DesktopCircleClient'

const overview: CircleOverview = {
  status: 'empty',
  reason: 'no-circles',
  circles: [],
  activeCircleId: null,
  viewerPersonId: null,
  tree: null,
  notifications: [],
}

const details: CircleDetails = {
  circle: {
    id: 'g-1',
    name: 'Test Family',
    role: 'Circle owner',
    memberCount: 2,
    pendingInvitationCount: 1,
  },
  members: [
    { personId: 'user:88', name: 'Owner', email: 'owner@example.test', role: 'Parent', isViewer: true, isOwner: true },
    { personId: 'user:99', name: 'Sibling', email: 'sibling@example.test', role: 'Sibling', isViewer: false, isOwner: false },
  ],
  invitations: [
    { personId: 'invite:inv-1', email: 'pending@example.test', role: 'Child', status: 'pending' },
  ],
}

describe('DesktopCircleClient management surface', () => {
  it('reads authoritative Circle details directly and shares one in-flight request', async () => {
    let resolveDetails!: (value: CircleDetails | null) => void
    const request = new Promise<CircleDetails | null>((resolve) => { resolveDetails = resolve })
    const getCircleDetails = vi.fn(() => request)
    const client = new DesktopCircleClient(async () => overview, Date.now, { getCircleDetails })

    const first = client.getCircleDetails()
    const second = client.getCircleDetails()
    expect(getCircleDetails).toHaveBeenCalledTimes(1)

    resolveDetails(details)
    await expect(first).resolves.toEqual(details)
    await expect(second).resolves.toEqual(details)
  })

  it('delegates management mutations with only personId and invalidates overview/details reads', async () => {
    const getOverview = vi.fn(async () => overview)
    const getCircleDetails = vi.fn(async () => details)
    const resendInvitation = vi.fn(async () => ({ outcome: 'sent' as const }))
    const cancelInvitation = vi.fn(async () => ({ success: true as const }))
    const removeMember = vi.fn(async () => ({ success: true as const }))
    const leaveCircle = vi.fn(async () => ({ success: true as const }))
    const client = new DesktopCircleClient(getOverview, Date.now, {
      getCircleDetails,
      resendInvitation,
      cancelInvitation,
      removeMember,
      leaveCircle,
    })

    await client.getHomeSnapshot()
    await client.getCircleDetails()

    await expect(client.resendInvitation('invite:inv-1')).resolves.toEqual({ outcome: 'sent' })
    expect(resendInvitation).toHaveBeenCalledWith({ personId: 'invite:inv-1' })
    await client.getHomeSnapshot()
    await client.getCircleDetails()
    expect(getOverview).toHaveBeenCalledTimes(2)
    expect(getCircleDetails).toHaveBeenCalledTimes(2)

    await expect(client.cancelInvitation('invite:inv-1')).resolves.toBeUndefined()
    expect(cancelInvitation).toHaveBeenCalledWith({ personId: 'invite:inv-1' })

    await expect(client.removeMember('user:99')).resolves.toBeUndefined()
    expect(removeMember).toHaveBeenCalledWith({ personId: 'user:99' })

    await expect(client.leaveCircle()).resolves.toBeUndefined()
    expect(leaveCircle).toHaveBeenCalledWith()
  })

  it('clears stale details after a failed management mutation', async () => {
    const getCircleDetails = vi.fn(async () => details)
    const cancelInvitation = vi.fn(async () => { throw new Error('stale') })
    const client = new DesktopCircleClient(async () => overview, Date.now, {
      getCircleDetails,
      cancelInvitation,
    })

    await client.getCircleDetails()
    await expect(client.cancelInvitation('invite:gone')).rejects.toThrow('stale')
    await client.getCircleDetails()
    expect(getCircleDetails).toHaveBeenCalledTimes(2)
  })
})
