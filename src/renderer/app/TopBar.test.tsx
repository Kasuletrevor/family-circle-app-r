import { render, screen } from '@testing-library/react'
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
  it('renders protected user identity and real Circle notification chrome', async () => {
    render(
      <AppServicesProvider services={{ circle: circleWithShell('Example Family', 3) }}>
        <TopBar user={user} />
      </AppServicesProvider>,
    )

    expect(await screen.findByText('Example Family')).toBeInTheDocument()
    expect(screen.getByText('Ada Example')).toBeInTheDocument()
    expect(screen.getByText('AE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows a neutral Circle state and no fake badge when there are no unread notifications', async () => {
    render(
      <AppServicesProvider services={{ circle: circleWithShell(null, 0) }}>
        <TopBar user={user} />
      </AppServicesProvider>,
    )

    expect(await screen.findByText('No Circle yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
