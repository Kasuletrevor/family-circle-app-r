import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuthState, AuthUser, DesktopApi } from '../../../shared/desktopApi'
import type { AuthClient } from '../../services/auth/AuthClient'
import type { PrivateAiClient, PrivateAiStatus } from '../../services/ai/PrivateAiClient'
import { Settings } from './Settings'

const user: AuthUser = {
  id: 12,
  email: 'ada@example.test',
  name: 'Ada Example',
  accountOrigin: 'registered',
  mustChangePassword: false,
  onboardingCompleted: true,
}

function authClient(): AuthClient {
  return {
    restore: vi.fn(),
    signIn: vi.fn(),
    checkInvitation: vi.fn(),
    register: vi.fn(),
    signOut: vi.fn(),
    updateProfile: vi.fn(async (name: string): Promise<AuthState> => ({
      status: 'authenticated',
      user: { ...user, name },
    })),
    changePassword: vi.fn(async (): Promise<AuthState> => ({
      status: 'authenticated',
      user,
    })),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    getOnboardingState: vi.fn(),
    setInitialPassword: vi.fn(),
    getCircleContext: vi.fn(),
    completeOnboarding: vi.fn(),
  }
}

function privateAiClient(): PrivateAiClient {
  const ready: PrivateAiStatus = {
    state: 'ready',
    ready: true,
    repairRequired: false,
    totalSizeBytes: 704 * 1024 * 1024,
    version: 'private-ai-v2',
    message: 'Private AI is ready',
  }
  const paused: PrivateAiStatus = { ...ready, state: 'paused', ready: false, message: 'Private AI setup paused' }
  const notInstalled: PrivateAiStatus = { ...ready, state: 'not_installed', ready: false, message: 'Private AI is not installed' }
  return {
    getStatus: vi.fn(async () => ready),
    startSetup: vi.fn(async () => ready),
    pauseSetup: vi.fn(async () => paused),
    repair: vi.fn(async () => ready),
    remove: vi.fn(async () => notInstalled),
    onProgress: vi.fn(() => () => undefined),
  }
}

function appClient(): Pick<DesktopApi['app'], 'getVersion' | 'getPlatform' | 'createDatabaseBackup' | 'openDataFolder'> {
  return {
    getVersion: vi.fn(async () => '0.2.3'),
    getPlatform: vi.fn(async (): Promise<NodeJS.Platform> => 'win32'),
    createDatabaseBackup: vi.fn(async () => ({ canceled: false as const, fileName: 'Family-Circle-backup.db' })),
    openDataFolder: vi.fn(async () => ({ success: true as const })),
  }
}

describe('Settings', () => {
  it('shows real installed app and Private AI state', async () => {
    render(
      <Settings
        user={user}
        authClient={authClient()}
        privateAiClient={privateAiClient()}
        appClient={appClient()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(await screen.findByText('0.2.3')).toBeInTheDocument()
    expect(screen.getByText('win32')).toBeInTheDocument()
    expect(await screen.findByText('Ready (Offline)')).toBeInTheDocument()
    expect(screen.getByText('private-ai-v2')).toBeInTheDocument()
    expect(screen.getByText('704 MB')).toBeInTheDocument()
  })

  it('updates the authenticated profile and forwards the refreshed auth state', async () => {
    const auth = authClient()
    const onAuthStateChange = vi.fn()

    render(
      <Settings
        user={user}
        authClient={auth}
        privateAiClient={privateAiClient()}
        appClient={appClient()}
        onAuthStateChange={onAuthStateChange}
      />,
    )

    const name = screen.getByLabelText('Display name')
    fireEvent.change(name, { target: { value: 'Ada Kasule' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(auth.updateProfile).toHaveBeenCalledWith('Ada Kasule'))
    expect(onAuthStateChange).toHaveBeenCalledWith(expect.objectContaining({
      status: 'authenticated',
      user: expect.objectContaining({ name: 'Ada Kasule' }),
    }))
    expect(await screen.findByText('Profile updated.')).toBeInTheDocument()
  })

  it('changes password through the authenticated client and rejects mismatched confirmation locally', async () => {
    const auth = authClient()

    render(
      <Settings
        user={user}
        authClient={auth}
        privateAiClient={privateAiClient()}
        appClient={appClient()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'current-credential-value' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-credential-value-123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different-value-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('New passwords do not match.')).toBeInTheDocument()
    expect(auth.changePassword).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-credential-value-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => expect(auth.changePassword).toHaveBeenCalledWith({
      currentPassword: 'current-credential-value',
      newPassword: 'new-credential-value-123',
    }))
    expect(await screen.findByText(/fresh protected session/i)).toBeInTheDocument()
  })

  it('backs up local data and only removes Private AI after confirmation', async () => {
    const app = appClient()
    const ai = privateAiClient()

    render(
      <Settings
        user={user}
        authClient={authClient()}
        privateAiClient={ai}
        appClient={app}
      />,
    )

    await screen.findByText('Ready (Offline)')

    fireEvent.click(screen.getByRole('button', { name: 'Create database backup' }))
    await waitFor(() => expect(app.createDatabaseBackup).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Family-Circle-backup\.db/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open app data folder' }))
    await waitFor(() => expect(app.openDataFolder).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Remove Private AI' }))
    expect(ai.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove downloaded AI files' }))

    await waitFor(() => expect(ai.remove).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Not set up')).toBeInTheDocument()
  })
})
