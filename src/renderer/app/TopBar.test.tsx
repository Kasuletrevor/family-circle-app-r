import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AuthUser, CircleOverview } from '../../shared/desktopApi'
import type { CircleClient } from '../services/circle/CircleClient'
import { AppServicesProvider } from './services'
import { TopBar } from './TopBar'

const user: AuthUser = {
  id: 12,
  email: 'ada@example.test',
  name: 'Ada Example',
  accountOrigin: 'invited',
  mustChangePassword: false,
  onboardingCompleted: true,
}

function circleWithShell(
  activeCircleName: string | null,
  unreadNotifications: number,
  overrides: Partial<CircleClient> = {},
): CircleClient {
  const overview: CircleOverview = {
    status: 'ready',
    circles: [{ id: 'g-1', name: activeCircleName || 'Example Family', role: 'Circle owner' }],
    activeCircleId: 'g-1',
    viewerPersonId: 'user:12',
    viewerIsOwner: true,
    tree: {
      group: { id: 'g-1', name: activeCircleName || 'Example Family' },
      people: [],
      relations: [],
      positions: [],
    },
    notifications: unreadNotifications > 0 ? [{
      id: 'n-1',
      type: 'member_joined',
      title: 'A relative joined',
      message: 'A family member joined your Circle.',
      groupId: 'g-1',
      groupName: activeCircleName || 'Example Family',
      createdAt: 1_700_000_000_000,
      read: false,
    }] : [],
  }

  return {
    getOverview: vi.fn(async () => overview),
    getHomeSnapshot: vi.fn(),
    getMyCircles: vi.fn(async () => [
      { id: 'g-1', name: activeCircleName || 'Example Family', role: 'Circle owner', memberCount: 4, isActive: true },
      { id: 'g-2', name: 'Second Family', role: 'Family member', memberCount: 8, isActive: false },
    ]),
    getCircleDetails: vi.fn(async () => null),
    getShellSnapshot: vi.fn(async () => ({ activeCircleName, unreadNotifications })),
    selectCircle: vi.fn(async () => undefined),
    createCircle: vi.fn(async () => ({ circleId: 'g-new' })),
    inviteMember: vi.fn(async () => ({ outcome: 'sent' as const })),
    addTreeRelation: vi.fn(async () => ({ success: true as const })),
    deleteTreeRelation: vi.fn(async () => ({ success: true as const })),
    saveTreePosition: vi.fn(async () => ({ success: true as const })),
    markNotificationsRead: vi.fn(async () => undefined),
    resendInvitation: vi.fn(async () => ({ outcome: 'sent' as const })),
    cancelInvitation: vi.fn(async () => undefined),
    removeMember: vi.fn(async () => undefined),
    leaveCircle: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('TopBar', () => {
  it('opens the real Circle switcher, changes the active Circle, and lands on My Circles', async () => {
    const selectCircle = vi.fn(async () => undefined)
    const circle = circleWithShell('Example Family', 0, { selectCircle })

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppServicesProvider services={{ circle }}>
          <TopBar user={user} onSignOut={async () => undefined} />
          <Routes>
            <Route path="/circles" element={<div>Circles destination</div>} />
          </Routes>
        </AppServicesProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Example Family')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose active family circle' }))

    const menu = await screen.findByRole('menu', { name: 'Family circles' })
    expect(menu).toHaveTextContent('Second Family')
    fireEvent.click(screen.getByRole('menuitem', { name: /Second Family/i }))

    await waitFor(() => expect(selectCircle).toHaveBeenCalledWith('g-2'))
    expect(await screen.findByText('Circles destination')).toBeInTheDocument()
  })

  it('opens real notifications and marks unread items read through the protected client', async () => {
    const markNotificationsRead = vi.fn(async () => undefined)
    const circle = circleWithShell('Example Family', 1, { markNotificationsRead })

    render(
      <MemoryRouter>
        <AppServicesProvider services={{ circle }}>
          <TopBar user={user} onSignOut={async () => undefined} />
        </AppServicesProvider>
      </MemoryRouter>,
    )

    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' })
    fireEvent.click(bell)

    expect(await screen.findByRole('menu', { name: 'Notifications' })).toHaveTextContent('A relative joined')
    expect(screen.getByText('A family member joined your Circle.')).toBeInTheDocument()
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('opens the user menu and logs out through the provided action', async () => {
    const onSignOut = vi.fn(async () => undefined)

    render(
      <MemoryRouter>
        <AppServicesProvider services={{ circle: circleWithShell('Example Family', 0) }}>
          <TopBar user={user} onSignOut={onSignOut} />
        </AppServicesProvider>
      </MemoryRouter>,
    )

    await screen.findByText('Example Family')
    fireEvent.click(screen.getByRole('button', { name: 'Open user menu' }))

    expect(screen.getByRole('menu', { name: 'User menu' })).toBeInTheDocument()
    expect(screen.getByText('ada@example.test')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('shows a neutral Circle state and an empty notification menu when there is no activity', async () => {
    render(
      <MemoryRouter>
        <AppServicesProvider services={{ circle: circleWithShell(null, 0) }}>
          <TopBar user={user} onSignOut={async () => undefined} />
        </AppServicesProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('No Circle yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(await screen.findByRole('menu', { name: 'Notifications' })).toHaveTextContent('No notifications yet.')
  })
})
