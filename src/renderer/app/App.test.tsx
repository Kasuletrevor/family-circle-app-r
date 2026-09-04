import { fireEvent, render, screen, within } from '@testing-library/react'
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
  it('renders stable desktop navigation and routes /vault to the real private Vault screen', async () => {
    Object.defineProperty(window, 'familyCircle', {
      configurable: true,
      value: {
        vault: {
          listDocuments: async () => [],
          chooseAndUploadDocuments: async () => ({ canceled: true, items: [] }),
          openDocument: async () => ({ success: true }),
          retryExtraction: async () => { throw new Error('not used') },
          deleteDocument: async () => ({ success: true }),
          onUploadProgress: () => () => undefined,
        },
      },
    })

    render(
      <MemoryRouter initialEntries={['/family-tree']}>
        <AppServicesProvider services={{ circle: new MockCircleClient() }}>
          <App user={user} />
        </AppServicesProvider>
      </MemoryRouter>,
    )

    const primaryNavigation = within(screen.getByRole('navigation', { name: 'Primary navigation' }))
    for (const label of navigationLabels) {
      expect(primaryNavigation.getByRole('link', { name: label })).toBeInTheDocument()
    }

    expect(primaryNavigation.getByRole('link', { name: 'Family Tree' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Family Tree' })).toBeInTheDocument()
    expect(await screen.findByText('Kasule Family')).toBeInTheDocument()
    expect(screen.getByText('Ada Example')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /search family circle/i })).toBeInTheDocument()
    expect(screen.getByText('Ready (Offline)')).toBeInTheDocument()
    expect(primaryNavigation.getByRole('link', { name: 'Invitations' }).querySelector('.sidebar-link__badge')).toBeNull()

    fireEvent.click(primaryNavigation.getByRole('link', { name: 'Members' }))
    expect(await screen.findByRole('heading', { name: 'Kasule Family' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument()

    fireEvent.click(primaryNavigation.getByRole('link', { name: 'Invitations' }))
    expect(await screen.findByRole('heading', { name: 'Pending invitations' })).toBeInTheDocument()

    fireEvent.click(primaryNavigation.getByRole('link', { name: 'My Circles' }))
    expect(await screen.findByRole('heading', { name: 'My Circles' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Circle' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Kasule Family' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manage Kasule Family' })).toBeInTheDocument()

    fireEvent.click(primaryNavigation.getByRole('link', { name: 'Vault' }))
    expect(await screen.findByRole('heading', { name: 'Vault' })).toBeInTheDocument()
    expect(screen.getByText('Your private documents stay on this computer.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload documents' })).toBeEnabled()
  })
})
