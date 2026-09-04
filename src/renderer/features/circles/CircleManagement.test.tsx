import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppServicesProvider } from '../../app/services'
import type { CircleClient } from '../../services/circle/CircleClient'
import type { CircleManagementSnapshot } from '../../services/circle/types'
import { CircleManagement } from './CircleManagement'

const ownerDetails: CircleManagementSnapshot = {
  circle: {
    id: 'g-1',
    name: 'Kasule Family',
    role: 'Circle owner',
    memberCount: 2,
    pendingInvitationCount: 1,
  },
  members: [
    { personId: 'user:88', name: 'Trevor Kasule', email: 'trevor@example.test', role: 'Parent', isViewer: true, isOwner: true },
    { personId: 'user:99', name: 'John Kasule', email: 'john@example.test', role: 'Sibling', isViewer: false, isOwner: false },
  ],
  invitations: [
    { personId: 'invite:1', email: 'mary@example.test', role: 'Child', status: 'pending' },
  ],
}

function service(overrides: Partial<CircleClient> = {}): CircleClient {
  return {
    getHomeSnapshot: vi.fn(),
    getMyCircles: vi.fn(async () => []),
    getCircleDetails: vi.fn(async () => ownerDetails),
    getShellSnapshot: vi.fn(async () => ({ activeCircleName: 'Kasule Family', unreadNotifications: 0 })),
    selectCircle: vi.fn(async () => undefined),
    createCircle: vi.fn(async () => ({ circleId: 'g-new' })),
    inviteMember: vi.fn(async () => ({ outcome: 'sent' as const })),
    resendInvitation: vi.fn(async () => ({ outcome: 'sent' as const })),
    cancelInvitation: vi.fn(async () => undefined),
    removeMember: vi.fn(async () => undefined),
    leaveCircle: vi.fn(async () => undefined),
    ...overrides,
  }
}

function renderPage(circle: CircleClient, initialSection: 'members' | 'invitations' = 'members') {
  return render(
    <MemoryRouter>
      <AppServicesProvider services={{ circle }}>
        <CircleManagement initialSection={initialSection} />
      </AppServicesProvider>
    </MemoryRouter>,
  )
}

describe('CircleManagement', () => {
  it('renders authoritative active-Circle members and owner controls', async () => {
    renderPage(service())

    expect(await screen.findByRole('heading', { name: 'Kasule Family' })).toBeInTheDocument()
    expect(screen.getByText('2 members')).toBeInTheDocument()
    expect(screen.getByText('1 pending invitation')).toBeInTheDocument()
    expect(screen.getByText('John Kasule')).toBeInTheDocument()
    expect(screen.getByText('john@example.test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invite member' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove John Kasule' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Leave Circle' })).not.toBeInTheDocument()
  })

  it('renders pending invitations and lets the owner resend authoritatively', async () => {
    const resendInvitation = vi.fn(async () => ({ outcome: 'sent' as const }))
    renderPage(service({ resendInvitation }), 'invitations')

    expect(await screen.findByText('mary@example.test')).toBeInTheDocument()
    expect(screen.getByText('Child')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resend invitation to mary@example.test' }))
    expect(resendInvitation).toHaveBeenCalledWith('invite:1')
  })

  it('shows Leave only for a non-owner and hides all owner mutation controls', async () => {
    const memberDetails: CircleManagementSnapshot = {
      ...ownerDetails,
      circle: { ...ownerDetails.circle, role: 'Sibling' },
      members: ownerDetails.members.map((member) => ({ ...member, isOwner: false })),
    }
    renderPage(service({ getCircleDetails: vi.fn(async () => memberDetails) }))

    expect(await screen.findByRole('button', { name: 'Leave Circle' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite member' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove John Kasule/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Resend invitation/ })).not.toBeInTheDocument()
  })

  it('renders a safe choose-Circle state when there is no active Circle', async () => {
    renderPage(service({ getCircleDetails: vi.fn(async () => null) }))

    expect(await screen.findByRole('heading', { name: 'Choose a Circle' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to My Circles' })).toHaveAttribute('href', '/circles')
  })

  it('shows safe retry copy without surfacing raw load errors', async () => {
    const getCircleDetails = vi
      .fn<CircleClient['getCircleDetails']>()
      .mockRejectedValueOnce(new Error('secret backend details'))
      .mockResolvedValueOnce(ownerDetails)
    renderPage(service({ getCircleDetails }))

    expect(await screen.findByText("We couldn't load this Circle. Please try again.")).toBeInTheDocument()
    expect(screen.queryByText('secret backend details')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Kasule Family' })).toBeInTheDocument()
  })
})
