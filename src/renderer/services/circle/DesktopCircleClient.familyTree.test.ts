import { describe, expect, it, vi } from 'vitest'
import type { CircleOverview } from '../../../shared/desktopApi'
import { DesktopCircleClient } from './DesktopCircleClient'

const overview: CircleOverview = {
  status: 'ready',
  circles: [{ id: 'g-1', name: 'Test Family', role: 'Circle owner' }],
  activeCircleId: 'g-1',
  viewerPersonId: 'user:88',
  viewerIsOwner: true,
  tree: {
    group: { id: 'g-1', name: 'Test Family' },
    people: [
      { id: 'user:88', kind: 'user', name: 'Owner', email: 'owner@example.test', role: 'Circle owner' },
      { id: 'user:99', kind: 'user', name: 'Relative', email: 'relative@example.test', role: 'Family member' },
    ],
    relations: [],
    positions: [],
  },
  notifications: [],
}

describe('DesktopCircleClient Family Tree writes', () => {
  it('delegates only safe tree payloads and invalidates authoritative overview reads after every write', async () => {
    const getOverview = vi.fn(async () => overview)
    const addTreeRelation = vi.fn(async () => ({ success: true as const }))
    const deleteTreeRelation = vi.fn(async () => ({ success: true as const }))
    const saveTreePosition = vi.fn(async () => ({ success: true as const }))
    const client = new DesktopCircleClient(getOverview, Date.now, {
      addTreeRelation,
      deleteTreeRelation,
      saveTreePosition,
    } as never)

    await client.getShellSnapshot()
    expect(getOverview).toHaveBeenCalledTimes(1)

    await client.addTreeRelation({ kind: 'mother', aPersonId: 'user:88', bPersonId: 'user:99' })
    expect(addTreeRelation).toHaveBeenCalledWith({ kind: 'mother', aPersonId: 'user:88', bPersonId: 'user:99' })
    await client.getShellSnapshot()
    expect(getOverview).toHaveBeenCalledTimes(2)

    await client.deleteTreeRelation('r-1')
    expect(deleteTreeRelation).toHaveBeenCalledWith({ relationId: 'r-1' })
    await client.getShellSnapshot()
    expect(getOverview).toHaveBeenCalledTimes(3)

    await client.saveTreePosition({ personId: 'user:99', x: 25, y: -10 })
    expect(saveTreePosition).toHaveBeenCalledWith({ personId: 'user:99', x: 25, y: -10 })
    await client.getShellSnapshot()
    expect(getOverview).toHaveBeenCalledTimes(4)
  })
})
