import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppServicesProvider } from '../../app/services'
import type { CircleClient } from '../../services/circle/CircleClient'
import type { CircleManagementSnapshot } from '../../services/circle/types'
import { CircleManagement } from './CircleManagement'

const firstDetails: CircleManagementSnapshot = {
  circle: { id: 'g-1', name: 'Kasule Family', role: 'Circle owner', memberCount: 2, pendingInvitationCount: 0 },
  members: [
    { personId: 'user:88', name: 'Trevor', email: 'trevor@example.test', role: 'Parent', isViewer: true, isOwner: true },
    { personId: 'user:99', name: 'John', email: 'john@example.test', role: 'Sibling', isViewer: false, isOwner: false },
  ],
  invitations: [],
}

const fallbackDetails: CircleManagementSnapshot = {
  circle: { id: 'g-2', name: 'Ramos Family', role: 'Circle owner', memberCount: 1, pendingInvitationCount: 0 },
  members: [
    { personId: 'user:88', name: 'Trevor', email: 'trevor@example.test', role: 'Sibling', isViewer: true, isOwner: true },
  ],
  invitations: [],
}

it('shows a stable stale-Circle message and reloads repaired active details after mutation rejection', async () => {
  const getCircleDetails = vi
    .fn<CircleClient['getCircleDetails']>()
    .mockResolvedValueOnce(firstDetails)
    .mockResolvedValueOnce(fallbackDetails)
  const removeMember = vi.fn(async () => {
    throw new Error('That Circle is no longer available to your account')
  })
  const circle = {
    getHomeSnapshot: vi.fn(),
    getMyCircles: vi.fn(async () => []),
    getCircleDetails,
    getShellSnapshot: vi.fn(async () => ({ activeCircleName: 'Kasule Family', unreadNotifications: 0 })),
    selectCircle: vi.fn(async () => undefined),
    createCircle: vi.fn(async () => ({ circleId: 'g-new' })),
    inviteMember: vi.fn(async () => ({ outcome: 'sent' as const })),
    resendInvitation: vi.fn(async () => ({ outcome: 'sent' as const })),
    cancelInvitation: vi.fn(async () => undefined),
    removeMember,
    leaveCircle: vi.fn(async () => undefined),
  } satisfies CircleClient

  render(
    <MemoryRouter>
      <AppServicesProvider services={{ circle }}>
        <CircleManagement initialSection="members" />
      </AppServicesProvider>
    </MemoryRouter>,
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Remove John' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove member' }))

  expect(await screen.findByText('That Circle is no longer available to your account.')).toBeInTheDocument()
  await waitFor(() => expect(getCircleDetails).toHaveBeenCalledTimes(2))
  expect(await screen.findByRole('heading', { name: 'Ramos Family' })).toBeInTheDocument()
})
