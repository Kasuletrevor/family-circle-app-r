import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
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
  it('renders stable desktop navigation, exposes logout, and routes /vault to the real private Vault screen', async () => {
    const onSignOut = vi.fn(async () => undefined)

    Object.defineProperty(window, 'familyCircle', {
      configurable: true,
      value: {
        app: {
          getVersion: async () => '0.2.3',
          getPlatform: async () => 'win32',
        },
        settings: {
          createBackup: async () => ({ canceled: true, folderName: null, createdAt: null }),
        },
        vault: {
          listDocuments: async () => [],
          chooseAndUploadDocuments: async () => ({ canceled: true, items: [] }),
          openDocument: async () => ({ success: true }),
          retryExtraction: async () => { throw new Error('not used') },
          deleteDocument: async () => ({ success: true }),
          onUploadProgress: () => () => undefined,
        },
        privateAi: {
          getStatus: async () => ({
            state: 'ready',
            ready: true,
            repairRequired: false,
            totalSizeBytes: 0,
            version: 'test',
            message: null,
          }),
          startSetup: async () => { throw new Error('not used') },
          pauseSetup: async () => { throw new Error('not used') },
          repair: async () => { throw new Error('not used') },
          onProgress: () => () => undefined,
        },
      },
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppServicesProvider services={{ circle: new MockCircleClient() }}>
          <App user={user} onSignOut={onSignOut} />
        </AppServicesProvider>
      </MemoryRouter>,
    )

    const primaryNavigation = within(screen.getByRole('navigation', { name: 'Primary navigation' }))
    for (const label of navigationLabels) {
      expect(primaryNavigation.getByRole('link', { name: label })).toBeInTheDocument()
    }

    expect(await screen.findByRole('button', { name: 'Choose active family circle' })).toHaveTextContent('Kasule Family')
    expect(screen.getByText('Ada Example')).toBeInTheDocument()
    expect(primaryNavigation.getByRole('link', { name: 'Family Tree' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Memories' })).toBeNull()
    expect(primaryNavigation.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: /search family circle/i })).toBeNull()
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open user menu' }))
    expect(screen.getByRole('menu', { name: 'User menu' })).toBeInTheDocument()
    expect(screen.getByText('ada@example.test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Ready (Offline)')).toBeInTheDocument()
    expect(primaryNavigation.getByRole('link', { name: 'Invitations' }).querySelector('.sidebar-link__badge')).toBeNull()

    fireEvent.click(primaryNavigation.getByRole('link', { name: 'Family Tree' }))
    expect(await screen.findByRole('heading', { name: 'Family Tree' })).toBeInTheDocument()
    expect(screen.getByLabelText('Interactive family tree')).toBeInTheDocument()

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

    fireEvent.click(primaryNavigation.getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(await screen.findByText('v0.2.3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create backup' })).toBeInTheDocument()
  })

  it('routes /stories to the real private My Story studio instead of the Stories placeholder', async () => {
    Object.defineProperty(window, 'familyCircle', {
      configurable: true,
      value: {
        story: {
          get: async () => ({ schemaVersion: 1, answers: [], confirmedCount: 0 }),
          saveDraft: async () => ({ schemaVersion: 1, answers: [], confirmedCount: 0 }),
          confirmField: async () => ({ schemaVersion: 1, answers: [], confirmedCount: 0 }),
          retryIndexing: async () => ({ schemaVersion: 1, answers: [], confirmedCount: 0 }),
          saveNow: async () => ({ schemaVersion: 1, answers: [], confirmedCount: 0 }),
          getHistory: async () => [],
          restoreVersion: async () => ({ schemaVersion: 1, answers: [], confirmedCount: 0 }),
          chooseAndAddMedia: async () => ({ canceled: true, items: [] }),
          listMedia: async () => [],
          openMedia: async () => ({ success: true }),
          deleteMedia: async () => ({ success: true }),
          transcribeRecording: async () => ({ transcript: '' }),
          getVoiceStatus: async () => ({ state: 'not_installed', ready: false, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null }),
          startVoiceSetup: async () => ({ state: 'not_installed', ready: false, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null }),
          pauseVoiceSetup: async () => ({ state: 'paused', ready: false, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null }),
          repairVoiceSetup: async () => ({ state: 'not_installed', ready: false, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null }),
          onVoiceSetupProgress: () => () => undefined,
        },
      },
    })

    render(
      <MemoryRouter initialEntries={['/stories']}>
        <AppServicesProvider services={{ circle: new MockCircleClient() }}>
          <App user={user} onSignOut={vi.fn(async () => undefined)} />
        </AppServicesProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('0 of 16 memories confirmed')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My Story' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Stories' })).toBeNull()
  })
})