import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { CircleOverview, SaveTreePositionInput } from '../../../shared/desktopApi'
import type { CircleClient } from '../../services/circle/CircleClient'
import { FamilyTreePage } from './FamilyTreePage'

const ownerOverview: CircleOverview = {
  status: 'ready',
  activeCircleId: 'g-1',
  viewerPersonId: 'user:alice',
  viewerIsOwner: true,
  circles: [{ id: 'g-1', name: 'Kasule Family', role: 'Circle owner' }],
  tree: {
    group: { id: 'g-1', name: 'Kasule Family' },
    people: [
      { id: 'user:alice', kind: 'user', name: 'Alice', email: 'alice@example.test', role: 'Mother' },
      { id: 'user:bob', kind: 'user', name: 'Bob', email: 'bob@example.test', role: 'Sibling' },
      { id: 'placeholder:legacy', kind: 'placeholder', name: 'Legacy Relative', email: null, role: 'Grandparent' },
    ],
    relations: [
      { id: 'r-sibling', kind: 'sibling', aPersonId: 'user:alice', bPersonId: 'user:bob' },
      { id: 'r-legacy', kind: 'grandparent', aPersonId: 'placeholder:legacy', bPersonId: 'user:alice' },
    ],
    positions: [],
  },
  notifications: [],
}

function circleService(
  overview: CircleOverview,
  saveTreePosition: (input: SaveTreePositionInput) => Promise<{ success: true }>,
): CircleClient {
  return {
    getOverview: vi.fn(async () => overview),
    getHomeSnapshot: vi.fn(),
    getMyCircles: vi.fn(async () => []),
    getCircleDetails: vi.fn(async () => null),
    getShellSnapshot: vi.fn(async () => ({ activeCircleName: null, unreadNotifications: 0 })),
    selectCircle: vi.fn(async () => undefined),
    createCircle: vi.fn(async () => ({ circleId: 'g-new' })),
    inviteMember: vi.fn(async () => ({ outcome: 'sent' as const })),
    addTreeRelation: vi.fn(async () => ({ success: true as const })),
    deleteTreeRelation: vi.fn(async () => ({ success: true as const })),
    saveTreePosition,
    resendInvitation: vi.fn(async () => ({ outcome: 'sent' as const })),
    cancelInvitation: vi.fn(async () => undefined),
    removeMember: vi.fn(async () => undefined),
    leaveCircle: vi.fn(async () => undefined),
  } as unknown as CircleClient
}

function renderPage(overview: CircleOverview, saveTreePosition = vi.fn(async (_input: SaveTreePositionInput) => ({ success: true as const }))) {
  render(
    <MemoryRouter>
      <FamilyTreePage circle={circleService(overview, saveTreePosition)} />
    </MemoryRouter>,
  )
  return saveTreePosition
}

function drag(node: HTMLElement, xDelta: number, yDelta: number): HTMLElement {
  const svg = screen.getByTestId('family-tree-svg')
  fireEvent.pointerDown(node, { pointerId: 1, clientX: 100, clientY: 100 })
  fireEvent.pointerMove(svg, { pointerId: 1, clientX: 100 + xDelta, clientY: 100 + yDelta })
  fireEvent.pointerUp(svg, { pointerId: 1, clientX: 100 + xDelta, clientY: 100 + yDelta })
  return svg
}

describe('FamilyTreePage position persistence', () => {
  it('persists one position write after a completed owner drag', async () => {
    const saveTreePosition = renderPage(ownerOverview)
    const alice = await screen.findByRole('button', { name: 'Select Alice' })

    drag(alice, 70, 35)

    await waitFor(() => expect(saveTreePosition).toHaveBeenCalledTimes(1))
    expect(saveTreePosition).toHaveBeenCalledWith(expect.objectContaining({
      personId: 'user:alice',
      x: expect.any(Number),
      y: expect.any(Number),
    }))
  })

  it('keeps a successful dragged position across parent selection rerenders', async () => {
    const saveTreePosition = renderPage(ownerOverview)
    const alice = await screen.findByRole('button', { name: 'Select Alice' })
    const originalX = Number(alice.getAttribute('data-x'))
    const originalY = Number(alice.getAttribute('data-y'))

    drag(alice, 70, 35)
    await waitFor(() => expect(saveTreePosition).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(Number(alice.getAttribute('data-x'))).not.toBe(originalX)
      expect(Number(alice.getAttribute('data-y'))).not.toBe(originalY)
    })
    const draggedX = Number(alice.getAttribute('data-x'))
    const draggedY = Number(alice.getAttribute('data-y'))

    fireEvent.click(alice)
    expect(alice).toHaveAttribute('aria-pressed', 'true')

    await waitFor(() => {
      expect(Number(alice.getAttribute('data-x'))).toBe(draggedX)
      expect(Number(alice.getAttribute('data-y'))).toBe(draggedY)
    })
  })

  it('ordinary member can persist only the viewer node movement', async () => {
    const memberOverview: CircleOverview = {
      ...ownerOverview,
      viewerIsOwner: false,
      viewerPersonId: 'user:alice',
    }
    const saveTreePosition = renderPage(memberOverview)

    drag(await screen.findByRole('button', { name: 'Select Bob' }), 40, 20)
    expect(saveTreePosition).not.toHaveBeenCalled()

    drag(screen.getByRole('button', { name: 'Select Alice' }), 40, 20)
    await waitFor(() => expect(saveTreePosition).toHaveBeenCalledTimes(1))
    expect(saveTreePosition.mock.calls[0][0].personId).toBe('user:alice')
  })

  it('never offers drag persistence for placeholder nodes', async () => {
    const saveTreePosition = renderPage(ownerOverview)

    drag(await screen.findByRole('button', { name: 'Select Legacy Relative' }), 80, 40)

    expect(saveTreePosition).not.toHaveBeenCalled()
  })

  it('shows a safe error and visually rolls back when save fails', async () => {
    const saveTreePosition = vi.fn(async (_input: SaveTreePositionInput) => {
      throw new Error('https://internal.example.test position secret')
    })
    renderPage(ownerOverview, saveTreePosition)
    const alice = await screen.findByRole('button', { name: 'Select Alice' })
    const originalX = Number(alice.getAttribute('data-x'))
    const originalY = Number(alice.getAttribute('data-y'))

    drag(alice, 90, 45)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this position')
    expect(screen.queryByText(/internal\.example\.test|position secret/i)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(Number(alice.getAttribute('data-x'))).toBe(originalX)
      expect(Number(alice.getAttribute('data-y'))).toBe(originalY)
    })
  })
})
