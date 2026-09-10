import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { CircleOverview } from '../../../shared/desktopApi'
import type { CircleClient } from '../../services/circle/CircleClient'
import { FamilyTreePage } from './FamilyTreePage'

const readyOverview: CircleOverview = {
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
      { id: 'placeholder:legacy', kind: 'placeholder', name: 'Legacy Relative', email: null, role: 'Grandparent' },
      { id: 'invite:i-1', kind: 'invite', name: 'Pending Person', email: 'pending@example.test', role: 'Cousin' },
    ],
    relations: [
      { id: 'r-sibling', kind: 'sibling', aPersonId: 'user:alice', bPersonId: 'user:bob' },
      { id: 'r-legacy', kind: 'grandparent', aPersonId: 'placeholder:legacy', bPersonId: 'user:alice' },
    ],
    positions: [],
  },
  notifications: [],
}

const secondOverview: CircleOverview = {
  status: 'ready',
  activeCircleId: 'g-2',
  viewerPersonId: 'user:charles',
  viewerIsOwner: false,
  circles: readyOverview.circles,
  tree: {
    group: { id: 'g-2', name: 'Ramos Family' },
    people: [
      { id: 'user:charles', kind: 'user', name: 'Charles', email: 'charles@example.test', role: 'Sibling' },
    ],
    relations: [],
    positions: [],
  },
  notifications: [],
}

function circleService(
  getOverview: () => Promise<CircleOverview>,
  overrides: Partial<CircleClient> = {},
): CircleClient {
  return {
    getOverview,
    getHomeSnapshot: vi.fn(),
    getMyCircles: vi.fn(async () => []),
    getCircleDetails: vi.fn(async () => null),
    getShellSnapshot: vi.fn(async () => ({ activeCircleName: null, unreadNotifications: 0 })),
    selectCircle: vi.fn(async () => undefined),
    createCircle: vi.fn(async () => ({ circleId: 'g-new' })),
    inviteMember: vi.fn(async () => ({ outcome: 'sent' as const })),
    addTreeRelation: vi.fn(async () => ({ success: true as const })),
    deleteTreeRelation: vi.fn(async () => ({ success: true as const })),
    saveTreePosition: vi.fn(async () => ({ success: true as const })),
    resendInvitation: vi.fn(async () => ({ outcome: 'sent' as const })),
    cancelInvitation: vi.fn(async () => undefined),
    removeMember: vi.fn(async () => undefined),
    leaveCircle: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as CircleClient
}

function renderPage(circle: CircleClient) {
  return render(
    <MemoryRouter>
      <FamilyTreePage circle={circle} />
    </MemoryRouter>,
  )
}

describe('FamilyTreePage read-only experience', () => {
  it('shows Go to My Circles when the protected overview has no Circle', async () => {
    const empty: CircleOverview = {
      status: 'empty',
      reason: 'no-circles',
      circles: [],
      activeCircleId: null,
      viewerPersonId: null,
      viewerIsOwner: false,
      tree: null,
      notifications: [],
    }
    renderPage(circleService(async () => empty))

    expect(await screen.findByRole('heading', { name: 'Your family tree starts with a Circle.' })).toBeInTheDocument()
    expect(screen.getByText('Create or join a Circle first.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to My Circles' })).toHaveAttribute('href', '/circles')
  })

  it('renders active Circle name, confirmed-member count, and pending invitation count', async () => {
    renderPage(circleService(async () => readyOverview))

    expect(await screen.findByRole('heading', { name: 'Family Tree' })).toBeInTheDocument()
    expect(screen.getByText('Kasule Family')).toBeInTheDocument()
    expect(screen.getByText('2 members · 1 invitation pending')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Circle' })).toHaveValue('g-1')
  })

  it('renders the normalized tree canvas without pending invitation nodes', async () => {
    renderPage(circleService(async () => readyOverview))

    expect(await screen.findByLabelText('Interactive family tree')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Legacy Relative')).toBeInTheDocument()
    expect(screen.queryByText('Pending Person')).not.toBeInTheDocument()
  })

  it('shows distinct owner and non-owner copy when there are no relationships yet without adding mutation controls', async () => {
    const ownerEmpty: CircleOverview = {
      ...readyOverview,
      tree: { ...readyOverview.tree, relations: [] },
    }
    const first = renderPage(circleService(async () => ownerEmpty))
    expect(await screen.findByText('Your family members are here.')).toBeInTheDocument()
    expect(screen.getByText('Connect them to build your tree.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add relationship/i })).not.toBeInTheDocument()
    first.unmount()

    const memberEmpty: CircleOverview = {
      ...secondOverview,
      tree: { ...secondOverview.tree, relations: [] },
    }
    renderPage(circleService(async () => memberEmpty))
    expect(await screen.findByText("Relationships haven't been added yet.")).toBeInTheDocument()
    expect(screen.getByText('The Circle owner can build this family tree.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add relationship/i })).not.toBeInTheDocument()
  })

  it('switches Circle through selectCircle and then reloads the authoritative overview', async () => {
    const getOverview = vi
      .fn<() => Promise<CircleOverview>>()
      .mockResolvedValueOnce(readyOverview)
      .mockResolvedValueOnce(secondOverview)
    const selectCircle = vi.fn(async () => undefined)
    renderPage(circleService(getOverview, { selectCircle }))

    const selector = await screen.findByRole('combobox', { name: 'Circle' })
    fireEvent.change(selector, { target: { value: 'g-2' } })

    expect(await screen.findByText('Ramos Family')).toBeInTheDocument()
    expect(selectCircle).toHaveBeenCalledWith('g-2')
    expect(getOverview).toHaveBeenCalledTimes(2)
  })

  it('shows a safe sync error and retries without revealing backend details', async () => {
    const getOverview = vi
      .fn<() => Promise<CircleOverview>>()
      .mockRejectedValueOnce(new Error('https://internal.example.test secret'))
      .mockResolvedValueOnce(readyOverview)
    renderPage(circleService(getOverview))

    expect(await screen.findByText("We couldn't sync this Family Tree.")).toBeInTheDocument()
    expect(screen.queryByText(/internal\.example\.test|secret/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Kasule Family')).toBeInTheDocument()
    expect(getOverview).toHaveBeenCalledTimes(2)
  })

  it('shows a selected confirmed-person inspector with safe derived relationships', async () => {
    renderPage(circleService(async () => readyOverview))

    fireEvent.click(await screen.findByRole('button', { name: 'Select Alice' }))
    const inspector = screen.getByLabelText('Person details')
    expect(within(inspector).getByRole('heading', { name: 'Alice' })).toBeInTheDocument()
    expect(within(inspector).getByText('Mother')).toBeInTheDocument()
    expect(within(inspector).getByText('You')).toBeInTheDocument()
    expect(within(inspector).getByText('Sibling of Bob')).toBeInTheDocument()
    expect(within(inspector).getByText('Grandchild of Legacy Relative')).toBeInTheDocument()
  })

  it('shows a legacy placeholder as a read-only Family record with no mutation controls', async () => {
    renderPage(circleService(async () => readyOverview))

    fireEvent.click(await screen.findByRole('button', { name: 'Select Legacy Relative' }))
    const inspector = screen.getByLabelText('Person details')
    expect(within(inspector).getByRole('heading', { name: 'Legacy Relative' })).toBeInTheDocument()
    expect(within(inspector).getByText('Grandparent')).toBeInTheDocument()
    expect(within(inspector).getByText('Family record')).toBeInTheDocument()
    expect(within(inspector).queryByRole('button', { name: /edit|remove|delete/i })).not.toBeInTheDocument()
  })
})
