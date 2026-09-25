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
        state: 'not_installed',
        ready: false,
        repairRequired: false,
        totalSizeBytes: 704 * 1024 * 1024,
        version: 'qwen3.5-0.8b',
        message: null,
      })),
      startSetup,
      pauseSetup: vi.fn(async () => ({
        state: 'paused', ready: false, repairRequired: false, totalSizeBytes: 704 * 1024 * 1024,
        version: 'qwen3.5-0.8b', message: 'Private AI setup paused',
      })),
      repair: vi.fn(async () => ({
        state: 'ready', ready: true, repairRequired: false, totalSizeBytes: 704 * 1024 * 1024,
        version: 'qwen3.5-0.8b', message: 'Private AI is ready',
      })),
      onProgress: vi.fn(() => () => undefined),
    }

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
      settings: { createBackup },
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

    expect(screen.queryByRole('button', { name: /restore/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /remove private ai/i })).toBeNull()
  })

  it('validates password confirmation before crossing the desktop boundary', async () => {
    const changePassword = vi.fn()
    const auth = {
      updateProfile: vi.fn(async () => authenticated()),
      changePassword,
    } as unknown as AuthClient
    const privateAi: PrivateAiClient = {
      getStatus: vi.fn(async () => ({
        state: 'ready', ready: true, repairRequired: false, totalSizeBytes: 0, version: 'test', message: null,
      })),
      startSetup: vi.fn(),
      pauseSetup: vi.fn(),
      repair: vi.fn(),
      onProgress: vi.fn(() => () => undefined),
    }
    const desktop = {
      app: { getVersion: vi.fn(async () => '0.2.3'), getPlatform: vi.fn(async () => 'win32' as const) },
      settings: { createBackup: vi.fn() },
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
})
