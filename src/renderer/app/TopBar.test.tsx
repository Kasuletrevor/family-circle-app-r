import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
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

function circleWithShell(activeCircleName: string | null, unreadNotifications: number): CircleClient {
  return {
    getHomeSnapshot: vi.fn(),
    getMyCircles: vi.fn(),
    getShellSnapshot: vi.fn(async () => ({ activeCircleName, unreadNotifications })),
  } as unknown as CircleClient
}

describe('TopBar', () => {
  it('renders protected identity, hides unimplemented chrome, and navigates the Circle chooser', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppServicesProvider services={{ circle: circleWithShell('Example Family', 3) }}>
          <TopBar user={user} onSignOut={async () => undefined} />
          <Routes>
            <Route path="/circles" element={<div>Circles destination</div>} />
          </Routes>
        </AppServicesProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Example Family')).toBeInTheDocument()
    expect(screen.getByText('Ada Example')).toBeInTheDocument()
    expect(screen.getByText('AE')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /notifications/i })).toBeNull()
    expect(screen.queryByRole('searchbox', { name: /search family circle/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Choose active family circle' }))
    expect(screen.getByText('Circles destination')).toBeInTheDocument()
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

  it('shows a neutral Circle state and no fake badge when there are no unread notifications', async () => {
    render(
      <MemoryRouter>
        <AppServicesProvider services={{ circle: circleWithShell(null, 0) }}>
          <TopBar user={user} onSignOut={async () => undefined} />
        </AppServicesProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('No Circle yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose active family circle' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /notifications/i })).toBeNull()
  })
})
