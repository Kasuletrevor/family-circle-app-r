import { describe, expect, it, vi } from 'vitest'
import type { CircleOverview } from '../../../shared/desktopApi'
import { DesktopCircleClient } from './DesktopCircleClient'

function overview(activeCircleId: string): CircleOverview {
  return {
    status: 'ready',
    activeCircleId,
    viewerPersonId: 'user:1',
    circles: [{ id: activeCircleId, name: 'Family', role: 'Circle owner' }],
    tree: { group: { id: activeCircleId, name: 'Family' }, people: [], relations: [], positions: [] },
    notifications: [],
  }
}

describe('DesktopCircleClient Circle changes', () => {
  it('announces when the server makes a different Circle active, but not on the first overview', async () => {
    let active = 'g-1'
    const client = new DesktopCircleClient(async () => overview(active))
    const changes = vi.fn()
    client.onChange(changes)

    await client.getOverview()
    expect(changes).not.toHaveBeenCalled()

    // For example, the saved Circle was deleted elsewhere and the server chose another.
    active = 'g-2'
    await client.getOverview()
    await Promise.resolve()
    expect(changes).toHaveBeenCalledWith({ activeCircleChanged: true })

    changes.mockClear()
    await client.getOverview()
    await Promise.resolve()
    expect(changes).not.toHaveBeenCalled()
  })

  it('ignores an overview that was superseded by a newer one', async () => {
    const pending: Array<(value: CircleOverview) => void> = []
    const client = new DesktopCircleClient(() => new Promise<CircleOverview>((resolve) => { pending.push(resolve) }), () => 0, {
      selectCircle: async () => ({ success: true }),
    })
    const changes = vi.fn()

    const first = client.getOverview()
    pending[0]!(overview('g-1'))
    await first
    await Promise.resolve()

    const stale = client.getOverview() // still for Circle A when the switch happens
    await client.selectCircle('g-2')
    client.onChange(changes)
    const fresh = client.getOverview()
    pending[2]!(overview('g-2'))
    await fresh
    await Promise.resolve()
    changes.mockClear()

    pending[1]!(overview('g-1'))
    await stale
    await Promise.resolve()
    expect(changes).not.toHaveBeenCalled()
  })

  it('announces a switch only when selecting a Circle succeeds', async () => {
    const selectCircle = vi.fn()
      .mockRejectedValueOnce(new Error('That Circle is no longer available to your account'))
      .mockResolvedValueOnce({ success: true })
    const client = new DesktopCircleClient(async () => overview('g-1'), () => 0, { selectCircle })
    const changes = vi.fn()
    client.onChange(changes)

    await expect(client.selectCircle('g-9')).rejects.toThrow()
    expect(changes).toHaveBeenLastCalledWith({ activeCircleChanged: false })
    await client.selectCircle('g-2')
    expect(changes).toHaveBeenLastCalledWith({ activeCircleChanged: true })
  })
})
