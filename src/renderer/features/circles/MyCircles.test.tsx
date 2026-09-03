import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppServicesProvider } from '../../app/services'
import type { CircleClient } from '../../services/circle/CircleClient'
import type { CircleSummary } from '../../services/circle/types'
import { MyCircles } from './MyCircles'

const circles: CircleSummary[] = [
  { id: 'circle-a', name: 'Kasule Family', role: 'Circle owner', memberCount: 8, isActive: true },
  { id: 'circle-b', name: 'Ramos Family', role: 'Sibling', memberCount: 14, isActive: false },
]

function service(overrides: Partial<CircleClient> = {}): CircleClient {
  return {
    getHomeSnapshot: vi.fn(),
    getMyCircles: vi.fn(async () => circles),
    getShellSnapshot: vi.fn(async () => ({ activeCircleName: 'Kasule Family', unreadNotifications: 0 })),
    selectCircle: vi.fn(async () => undefined),
    createCircle: vi.fn(async () => ({ circleId: 'circle-new' })),
    inviteMember: vi.fn(async () => ({ outcome: 'sent' as const })),
    ...overrides,
  }
}

function renderPage(circle: CircleClient) {
  return render(
    <MemoryRouter initialEntries={['/circles']}>
      <AppServicesProvider services={{ circle }}>
        <Routes>
          <Route path="/circles" element={<MyCircles />} />
          <Route path="/" element={<h1>Home destination</h1>} />
        </Routes>
      </AppServicesProvider>
    </MemoryRouter>,
  )
}

describe('MyCircles', () => {
  it('renders real Circle cards with authoritative counts and owner-only Invite actions', async () => {
    renderPage(service())

    expect(await screen.findByRole('heading', { name: 'My Circles' })).toBeInTheDocument()
    expect(screen.getByText('Kasule Family')).toBeInTheDocument()
    expect(screen.getByText('8 members')).toBeInTheDocument()
    expect(screen.getByText('Ramos Family')).toBeInTheDocument()
    expect(screen.getByText('14 members')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invite to Kasule Family' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite to Ramos Family' })).not.toBeInTheDocument()
  })

  it('renders the intentional first-Circle empty state and opens the same create dialog', async () => {
    renderPage(service({ getMyCircles: vi.fn(async () => []) }))

    expect(await screen.findByRole('heading', { name: 'Your family starts here' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create your first Circle' }))
    expect(screen.getByRole('dialog', { name: 'Create a family circle' })).toBeInTheDocument()
  })

  it('opens only after protected selection succeeds, then navigates Home', async () => {
    const selectCircle = vi.fn(async () => undefined)
    renderPage(service({ selectCircle }))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Ramos Family' }))

    expect(await screen.findByRole('heading', { name: 'Home destination' })).toBeInTheDocument()
    expect(selectCircle).toHaveBeenCalledWith('circle-b')
  })

  it('stays on the page with safe copy when protected selection fails', async () => {
    renderPage(service({ selectCircle: vi.fn(async () => { throw new Error('raw backend details') }) }))

    fireEvent.click(await screen.findByRole('button', { name: 'Open Ramos Family' }))

    expect(await screen.findByText('That Circle is no longer available to your account.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My Circles' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Home destination' })).not.toBeInTheDocument()
  })

  it('shows a retryable safe error when the Circle list cannot load', async () => {
    const getMyCircles = vi
      .fn<CircleClient['getMyCircles']>()
      .mockRejectedValueOnce(new Error('secret network details'))
      .mockResolvedValueOnce(circles)
    renderPage(service({ getMyCircles }))

    expect(await screen.findByText("We couldn't load your Circles. Please try again.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Kasule Family')).toBeInTheDocument()
    expect(getMyCircles).toHaveBeenCalledTimes(2)
  })

  it('creates through the protected client, closes the dialog, and reloads authoritative Circle cards', async () => {
    const refreshed: CircleSummary[] = [
      ...circles.map((item) => ({ ...item, isActive: false })),
      { id: 'circle-new', name: 'New Family', role: 'Circle owner', memberCount: 1, isActive: true },
    ]
    const getMyCircles = vi
      .fn<CircleClient['getMyCircles']>()
      .mockResolvedValueOnce(circles)
      .mockResolvedValueOnce(refreshed)
    const createCircle = vi.fn(async () => ({ circleId: 'circle-new' }))
    renderPage(service({ getMyCircles, createCircle }))

    fireEvent.click(await screen.findByRole('button', { name: 'Create Circle' }))
    fireEvent.change(screen.getByLabelText('Circle name'), { target: { value: 'New Family' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Circle' }))

    expect(await screen.findByText('New Family')).toBeInTheDocument()
    expect(createCircle).toHaveBeenCalledWith({ name: 'New Family' })
    expect(getMyCircles).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog', { name: 'Create a family circle' })).not.toBeInTheDocument()
  })
})
