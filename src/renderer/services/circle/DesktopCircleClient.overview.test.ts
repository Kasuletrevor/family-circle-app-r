import { describe, expect, it, vi } from 'vitest'
import type { CircleOverview } from '../../../shared/desktopApi'
import { DesktopCircleClient } from './DesktopCircleClient'

const overview: CircleOverview = {
  status: 'ready',
  activeCircleId: 'g-1',
  viewerPersonId: 'user:alice',
  viewerIsOwner: true,
  circles: [
    { id: 'g-1', name: 'Kasule Family', role: 'Circle owner' },
    { id: 'g-2', name: 'Ramos Family', role: 'Sibling' },
  ],
  tree: {
    group: { id: 'g-1', name: 'Kasule Family' },
    people: [
      { id: 'user:alice', kind: 'user', name: 'Alice', email: 'alice@example.test', role: 'Mother' },
      { id: 'user:bob', kind: 'user', name: 'Bob', email: 'bob@example.test', role: 'Sibling' },
      { id: 'invite:i-1', kind: 'invite', name: 'Pending Person', email: 'pending@example.test', role: 'Cousin' },
    ],
    relations: [{ id: 'r-1', kind: 'sibling', aPersonId: 'user:alice', bPersonId: 'user:bob' }],
    positions: [{ personId: 'user:alice', x: 20, y: 40 }],
  },
  notifications: [],
}

describe('DesktopCircleClient Family Tree overview', () => {
  it('exposes the full safe overview without remapping it and shares the in-flight read with shell consumers', async () => {
    let resolveOverview!: (value: CircleOverview) => void
    const pending = new Promise<CircleOverview>((resolve) => { resolveOverview = resolve })
    const fetchOverview = vi.fn(() => pending)
    const client = new DesktopCircleClient(fetchOverview)

    const treeOverview = client.getOverview()
    const shell = client.getShellSnapshot()
    resolveOverview(overview)

    await expect(treeOverview).resolves.toEqual(overview)
    await expect(shell).resolves.toEqual({ activeCircleName: 'Kasule Family', unreadNotifications: 0 })
    expect(fetchOverview).toHaveBeenCalledTimes(1)
  })
})
