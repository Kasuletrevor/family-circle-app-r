import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import { MockCircleClient } from '../services/circle/MockCircleClient'
import { App } from './App'
import { AppServicesProvider } from './services'

const navigationLabels = [
  'Home',
  'My Circles',
  'Family Tree',
  'Members',
  'Invitations',
  'Stories',
  'Vault',
  'Memories',
  'AI Assistant',
  'Settings',
]

const user: AuthUser = {
  id: 12,
  email: 'ada@example.test',
  name: 'Ada Example',
  accountOrigin: 'registered',
  mustChangePassword: false,
  onboardingCompleted: true,
}

describe('App shell', () => {
  it('renders stable desktop navigation and changes routes without leaving the shell', async () => {
    render(
      <MemoryRouter initialEntries={['/family-tree']}>
        <AppServicesProvider services={{ circle: new MockCircleClient() }}>
          <App user={user} />
        </AppServicesProvider>
      </MemoryRouter>,
    )

    for (const label of navigationLabels) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }

    expect(screen.getByRole('link', { name: 'Family Tree' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Family Tree' })).toBeInTheDocument()
    expect(await screen.findByText('Kasule Family')).toBeInTheDocument()
    expect(screen.getByText('Ada Example')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /search family circle/i })).toBeInTheDocument()
    expect(screen.getByText('Ready (Offline)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Members' }))
    expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument()
  })
})
