import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuthState, AuthUser, DesktopApi } from '../../../shared/desktopApi'
import type { AuthClient } from '../../services/auth/AuthClient'
import type { PrivateAiClient } from '../../services/ai/PrivateAiClient'
import { SettingsPage } from './SettingsPage'

const user: AuthUser = {
  id: 12,
  email: 'ada@example.test',
  name: 'Ada Example',
  accountOrigin: 'registered',
  mustChangePassword: false,
  onboardingCompleted: true,
}

function authenticated(name = user.name): AuthState {
  return { status: 'authenticated', user: { ...user, name } }
}

describe('SettingsPage', () => {
  it('backs every visible action with a real client operation', async () => {
    const updateProfile = vi.fn(async (name: string) => authenticated(name))
    const changePassword = vi.fn(async () => authenticated('Ada Updated'))
    const auth = {
      updateProfile,
      changePassword,
    } as unknown as AuthClient

    const startSetup = vi.fn(async () => ({
      state: 'ready' as const,
      ready: true,
      repairRequired: false,
      totalSizeBytes: 704 * 1024 * 1024,
      version: 'qwen3.5-0.8b',
      message: 'Private AI is ready',
    }))
    const privateAi: PrivateAiClient = {
      getStatus: vi.fn(async () => ({
        state: 'not_installed' as const,
        ready: false,
        repairRequired: false,
        totalSizeBytes: 704 * 1024 * 1024,
        version: 'qwen3.5-0.8b',
        message: null,
      })),
      startSetup,
      pauseSetup: vi.fn(async () => ({
        state: 'paused' as const, ready: false, repairRequired: false, totalSizeBytes: 704 * 1024 * 1024,
        version: 'qwen3.5-0.8b', message: 'Private AI setup paused',
      })),
      repair: vi.fn(async () => ({
        state: 'ready' as const, ready: true, repairRequired: false, totalSizeBytes: 704 * 1024 * 1024,
        version: 'qwen3.5-0.8b', message: 'Private AI is ready',
      })),
      remove: vi.fn(),
      onProgress: vi.fn(() => () => undefined),
    }

    const openDataFolder = vi.fn(async () => ({ success: true as const }))
    const createBackup = vi.fn(async () => ({
      canceled: false,
      folderName: 'Family Circle Backup 2026-09-25T10-00-00-000Z',
      createdAt: Date.parse('2026-09-25T10:00:00Z'),
    }))
    const desktop = {
      app: {
        getVersion: vi.fn(async () => '0.2.3'),
        getPlatform: vi.fn(async () => 'win32' as const),
      },
      settings: { createBackup, openDataFolder, restoreBackup: vi.fn() },
    } as Pick<DesktopApi, 'app' | 'settings'>

    const onAuthStateChange = vi.fn()

    render(
      <SettingsPage
        user={user}
        auth={auth}
        onAuthStateChange={onAuthStateChange}
        privateAi={privateAi}
        desktop={desktop}
      />,
    )

    expect(await screen.findByText('v0.2.3')).toBeInTheDocument()
    expect(screen.getByText('Windows')).toBeInTheDocument()
    expect(screen.getByText('Not set up')).toBeInTheDocument()
    expect(screen.getByText('704 MB')).toBeInTheDocument()
    expect(screen.getByText(/Answers by Qwen3\.5 0\.8B and search by Nomic Embed Text v1\.5, running on this computer\./)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Updated' } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith('Ada Updated'))
    expect(onAuthStateChange).toHaveBeenCalledWith(authenticated('Ada Updated'))
    expect(await screen.findByText('Profile updated.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'current password 123' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'another secure password 123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'another secure password 123' } })
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'current password 123',
      newPassword: 'another secure password 123',
    }))
    expect(await screen.findByText(/password changed/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Set up Private AI' }))
    await waitFor(() => expect(startSetup).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Ready (Offline)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }))
    await waitFor(() => expect(createBackup).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Backup created: Family Circle Backup/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open data folder' }))
    await waitFor(() => expect(openDataFolder).toHaveBeenCalledTimes(1))

    expect(screen.getByRole('button', { name: 'Restore from backup…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Private AI' })).toBeInTheDocument()
  })

  it('keeps Pause enabled while Private AI setup is still in flight', async () => {
    const progressListeners: Parameters<PrivateAiClient['onProgress']>[0][] = []
    let resolveSetup!: (status: Awaited<ReturnType<PrivateAiClient['startSetup']>>) => void
    const startSetup = vi.fn(() => new Promise<Awaited<ReturnType<PrivateAiClient['startSetup']>>>((resolve) => {
      resolveSetup = resolve
    }))
    const pauseSetup = vi.fn(async () => ({
      state: 'paused' as const,
      ready: false,
      repairRequired: false,
      totalSizeBytes: 704 * 1024 * 1024,
      version: 'qwen3.5-0.8b',
      message: 'Private AI setup paused',
    }))
    const privateAi: PrivateAiClient = {
      getStatus: vi.fn(async () => ({
        state: 'not_installed' as const,
        ready: false,
        repairRequired: false,
        totalSizeBytes: 704 * 1024 * 1024,
        version: 'qwen3.5-0.8b',
        message: null,
      })),
      startSetup,
      pauseSetup,
      repair: vi.fn(),
      remove: vi.fn(),
      onProgress: vi.fn((listener) => {
        progressListeners.push(listener)
        return () => undefined
      }),
    }
    const desktop = {
      app: { getVersion: vi.fn(async () => '0.2.3'), getPlatform: vi.fn(async () => 'win32' as const) },
      settings: { createBackup: vi.fn(), openDataFolder: vi.fn(), restoreBackup: vi.fn() },
    } as Pick<DesktopApi, 'app' | 'settings'>
    const auth = {
      updateProfile: vi.fn(async () => authenticated()),
      changePassword: vi.fn(async () => authenticated()),
    } as unknown as AuthClient

    render(
      <SettingsPage user={user} auth={auth} onAuthStateChange={() => undefined} privateAi={privateAi} desktop={desktop} />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Set up Private AI' }))
    await waitFor(() => expect(startSetup).toHaveBeenCalledTimes(1))

    expect(progressListeners).toHaveLength(1)
    progressListeners[0]!({
      state: 'downloading',
      message: 'Downloading Private AI',
      bytesDownloaded: 10,
      totalSizeBytes: 100,
      percent: 10,
      fileIndex: 1,
      fileCount: 3,
      fileName: 'model.gguf',
      fileBytesDownloaded: 10,
      fileSizeBytes: 100,
    })

    const pauseButton = await screen.findByRole('button', { name: 'Pause download' })
    expect(pauseButton).toBeEnabled()
    fireEvent.click(pauseButton)
    await waitFor(() => expect(pauseSetup).toHaveBeenCalledTimes(1))

    resolveSetup({
      state: 'paused',
      ready: false,
      repairRequired: false,
      totalSizeBytes: 704 * 1024 * 1024,
      version: 'qwen3.5-0.8b',
      message: 'Private AI setup paused',
    })
  })

  it('validates password confirmation before crossing the desktop boundary', async () => {
    const changePassword = vi.fn()
    const auth = {
      updateProfile: vi.fn(async () => authenticated()),
      changePassword,
    } as unknown as AuthClient
    const privateAi: PrivateAiClient = {
      getStatus: vi.fn(async () => ({
        state: 'ready' as const, ready: true, repairRequired: false, totalSizeBytes: 0, version: 'test', message: null,
      })),
      startSetup: vi.fn(),
      pauseSetup: vi.fn(),
      repair: vi.fn(),
      remove: vi.fn(),
      onProgress: vi.fn(() => () => undefined),
    }
    const desktop = {
      app: { getVersion: vi.fn(async () => '0.2.3'), getPlatform: vi.fn(async () => 'win32' as const) },
      settings: { createBackup: vi.fn(), openDataFolder: vi.fn(), restoreBackup: vi.fn() },
    } as Pick<DesktopApi, 'app' | 'settings'>

    render(
      <SettingsPage user={user} auth={auth} onAuthStateChange={() => undefined} privateAi={privateAi} desktop={desktop} />,
    )

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'current password 123' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'another secure password 123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different secure password 123' } })
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    expect(await screen.findByText('New passwords do not match.')).toBeInTheDocument()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('removes Private AI only after explicit confirmation', async () => {
    const readyStatus = {
      state: 'ready' as const, ready: true, repairRequired: false, totalSizeBytes: 704 * 1024 * 1024,
      version: 'qwen3.5-0.8b', message: null,
    }
    const remove = vi.fn(async () => ({
      ...readyStatus, state: 'not_installed' as const, ready: false, message: 'Private AI is not installed',
    }))
    const privateAi: PrivateAiClient = {
      getStatus: vi.fn(async () => readyStatus),
      startSetup: vi.fn(),
      pauseSetup: vi.fn(),
      repair: vi.fn(),
      remove,
      onProgress: vi.fn(() => () => undefined),
    }
    const desktop = {
      app: { getVersion: vi.fn(async () => '0.2.3'), getPlatform: vi.fn(async () => 'win32' as const) },
      settings: { createBackup: vi.fn(), openDataFolder: vi.fn(), restoreBackup: vi.fn() },
    } as Pick<DesktopApi, 'app' | 'settings'>

    render(
      <SettingsPage user={user} auth={{} as AuthClient} onAuthStateChange={() => undefined} privateAi={privateAi} desktop={desktop} />,
    )

    await screen.findByText('Ready (Offline)')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Private AI' }))
    expect(remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Remove downloaded AI files' })).not.toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Private AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove downloaded AI files' }))

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Not set up')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /set up private ai/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Private AI' })).not.toBeInTheDocument()
  })

  it('does not offer removal while Private AI is downloading and surfaces removal failures', async () => {
    const status = (state: 'downloading' | 'paused') => ({
      state, ready: false, repairRequired: false, totalSizeBytes: 0, version: 'test', message: null,
    })
    const getStatus = vi.fn(async () => status('downloading'))
    const privateAi: PrivateAiClient = {
      getStatus,
      startSetup: vi.fn(),
      pauseSetup: vi.fn(),
      repair: vi.fn(),
      remove: vi.fn(async () => { throw new Error('Pause Private AI setup before removing downloaded files') }),
      onProgress: vi.fn(() => () => undefined),
    }
    const desktop = {
      app: { getVersion: vi.fn(async () => '0.2.3'), getPlatform: vi.fn(async () => 'win32' as const) },
      settings: { createBackup: vi.fn(), openDataFolder: vi.fn(), restoreBackup: vi.fn() },
    } as Pick<DesktopApi, 'app' | 'settings'>

    const { unmount } = render(
      <SettingsPage user={user} auth={{} as AuthClient} onAuthStateChange={() => undefined} privateAi={privateAi} desktop={desktop} />,
    )
    await screen.findByText('Downloading')
    expect(screen.queryByRole('button', { name: 'Remove Private AI' })).not.toBeInTheDocument()
    unmount()

    getStatus.mockResolvedValue(status('paused'))
    render(
      <SettingsPage user={user} auth={{} as AuthClient} onAuthStateChange={() => undefined} privateAi={privateAi} desktop={desktop} />,
    )
    await screen.findByText('Paused')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Private AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove downloaded AI files' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Pause Private AI setup before removing downloaded files')
    expect(screen.getByRole('button', { name: 'Remove downloaded AI files' })).toBeEnabled()
  })

  it('surfaces a failure to open the data folder', async () => {
    const privateAi: PrivateAiClient = {
      getStatus: vi.fn(async () => ({
        state: 'ready' as const, ready: true, repairRequired: false, totalSizeBytes: 0, version: 'test', message: null,
      })),
      startSetup: vi.fn(),
      pauseSetup: vi.fn(),
      repair: vi.fn(),
      remove: vi.fn(),
      onProgress: vi.fn(() => () => undefined),
    }
    const desktop = {
      app: { getVersion: vi.fn(async () => '0.2.3'), getPlatform: vi.fn(async () => 'win32' as const) },
      settings: {
        createBackup: vi.fn(),
        openDataFolder: vi.fn(async () => { throw new Error('Could not open the Family Circle data folder.') }),
        restoreBackup: vi.fn(),
      },
    } as Pick<DesktopApi, 'app' | 'settings'>

    render(
      <SettingsPage user={user} auth={{} as AuthClient} onAuthStateChange={() => undefined} privateAi={privateAi} desktop={desktop} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open data folder' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open the Family Circle data folder.')
  })

  it('restores a backup only after confirmation and reports the restart', async () => {
    const restoreBackup = vi.fn(async () => ({ canceled: false as const, restarting: true as const }))
    const privateAi: PrivateAiClient = {
      getStatus: vi.fn(async () => ({
        state: 'ready' as const, ready: true, repairRequired: false, totalSizeBytes: 0, version: 'test', message: null,
      })),
      startSetup: vi.fn(),
      pauseSetup: vi.fn(),
      repair: vi.fn(),
      remove: vi.fn(),
      onProgress: vi.fn(() => () => undefined),
    }
    const desktop = {
      app: { getVersion: vi.fn(async () => '0.2.3'), getPlatform: vi.fn(async () => 'win32' as const) },
      settings: { createBackup: vi.fn(), openDataFolder: vi.fn(), restoreBackup },
    } as Pick<DesktopApi, 'app' | 'settings'>

    render(
      <SettingsPage user={user} auth={{} as AuthClient} onAuthStateChange={() => undefined} privateAi={privateAi} desktop={desktop} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Restore from backup…' }))
    expect(restoreBackup).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Choose backup and restore' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restore from backup…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose backup and restore' }))

    await waitFor(() => expect(restoreBackup).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/restarting to restore it/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restoring…' })).toBeDisabled()
  })

  it('shows restore validation errors and allows retry; a canceled picker changes nothing', async () => {
    const restoreBackup = vi.fn()
      .mockResolvedValueOnce({ canceled: true as const })
      .mockRejectedValueOnce(new Error('This backup belongs to a different Family Circle account.'))
    const privateAi: PrivateAiClient = {
      getStatus: vi.fn(async () => ({
        state: 'ready' as const, ready: true, repairRequired: false, totalSizeBytes: 0, version: 'test', message: null,
      })),
      startSetup: vi.fn(),
      pauseSetup: vi.fn(),
      repair: vi.fn(),
      remove: vi.fn(),
      onProgress: vi.fn(() => () => undefined),
    }
    const desktop = {
      app: { getVersion: vi.fn(async () => '0.2.3'), getPlatform: vi.fn(async () => 'win32' as const) },
      settings: { createBackup: vi.fn(), openDataFolder: vi.fn(), restoreBackup },
    } as Pick<DesktopApi, 'app' | 'settings'>

    render(
      <SettingsPage user={user} auth={{} as AuthClient} onAuthStateChange={() => undefined} privateAi={privateAi} desktop={desktop} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Restore from backup…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose backup and restore' }))
    await waitFor(() => expect(restoreBackup).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose backup and restore' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Choose backup and restore' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This backup belongs to a different Family Circle account.')
    expect(screen.getByRole('button', { name: 'Choose backup and restore' })).toBeEnabled()
  })
})
