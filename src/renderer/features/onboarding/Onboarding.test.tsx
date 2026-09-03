import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuthState } from '../../../shared/desktopApi'
import type { AuthClient } from '../../services/auth/AuthClient'
import { Onboarding } from './Onboarding'

const invitedState: Extract<AuthState, { status: 'onboarding' }> = {
  status: 'onboarding',
  user: {
    id: 7,
    email: 'invited@example.com',
    name: 'Invited Member',
    accountOrigin: 'invited',
    mustChangePassword: true,
    onboardingCompleted: false,
  },
}

const ownerState: Extract<AuthState, { status: 'onboarding' }> = {
  status: 'onboarding',
  user: {
    id: 8,
    email: 'owner@example.com',
    name: 'Owner',
    accountOrigin: 'registered',
    mustChangePassword: false,
    onboardingCompleted: false,
  },
}

function createClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    restore: vi.fn(),
    signIn: vi.fn(),
    checkInvitation: vi.fn(),
    register: vi.fn(),
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    getOnboardingState: vi.fn(),
    setInitialPassword: vi.fn(async (): Promise<AuthState> => ({
      ...invitedState,
      user: { ...invitedState.user, mustChangePassword: false },
    })),
    updateProfile: vi.fn(async (): Promise<AuthState> => ({
      ...invitedState,
      user: { ...invitedState.user, name: 'Trevor Kasule', mustChangePassword: false },
    })),
    getCircleContext: vi.fn(async () => ({
      accountOrigin: 'invited' as const,
      invitation: { groupId: 'g-1', groupName: 'Kasule Family', role: 'Member' },
      groups: [{ id: 'g-1', name: 'Kasule Family', role: 'Member' }],
    })),
    completeOnboarding: vi.fn(async (): Promise<AuthState> => ({
      status: 'authenticated',
      user: { ...invitedState.user, name: 'Trevor Kasule', mustChangePassword: false, onboardingCompleted: true },
    })),
    ...overrides,
  }
}

describe('Onboarding', () => {
  it('starts invited users with password rotation, then preserves profile progress into confirmed Circle membership', async () => {
    const client = createClient()
    const stateChanged = vi.fn()
    render(<Onboarding state={invitedState} client={client} onStateChange={stateChanged} />)

    expect(screen.getByText('Secure your account')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'abcdefghijkl' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'abcdefghijkl' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))

    await waitFor(() => expect(client.setInitialPassword).toHaveBeenCalledWith('abcdefghijkl'))
    expect(await screen.findByText('Your profile')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Family-visible name'), { target: { value: 'Trevor Kasule' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(client.updateProfile).toHaveBeenCalledWith('Trevor Kasule'))

    expect(await screen.findByText('Kasule Family')).toBeInTheDocument()
    expect(screen.getByText('Member')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Ready')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enter my family circle' }))
    await waitFor(() => expect(client.completeOnboarding).toHaveBeenCalledWith('joined-circle'))
    expect(stateChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'authenticated' }))
  })

  it('skips password rotation when it is not required', () => {
    const state = { ...invitedState, user: { ...invitedState.user, mustChangePassword: false } }
    render(<Onboarding state={state} client={createClient()} onStateChange={vi.fn()} />)
    expect(screen.getByText('Your profile')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save new password' })).not.toBeInTheDocument()
  })

  it('retries invited Circle confirmation without losing saved profile work', async () => {
    const getCircleContext = vi.fn()
      .mockRejectedValueOnce(new Error('Family Circle is temporarily unavailable.'))
      .mockResolvedValueOnce({
        accountOrigin: 'invited' as const,
        invitation: { groupId: 'g-1', groupName: 'Kasule Family', role: 'Member' },
        groups: [{ id: 'g-1', name: 'Kasule Family', role: 'Member' }],
      })
    const client = createClient({ getCircleContext })
    const state = { ...invitedState, user: { ...invitedState.user, mustChangePassword: false } }
    render(<Onboarding state={state} client={client} onStateChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Family-visible name'), { target: { value: 'Trevor Kasule' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Family Circle is temporarily unavailable.')
    expect(screen.getByText('Trevor Kasule')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try Circle again' }))
    expect(await screen.findByText('Kasule Family')).toBeInTheDocument()
    expect(getCircleContext).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['Create Circle', 'create-circle'],
    ['Explore First', 'home'],
  ] as const)('lets registered owners choose %s and completes with %s', async (label, action) => {
    const authenticated: AuthState = {
      status: 'authenticated',
      user: { ...ownerState.user, onboardingCompleted: true },
    }
    const client = createClient({
      updateProfile: vi.fn(async (): Promise<AuthState> => ownerState),
      completeOnboarding: vi.fn(async (): Promise<AuthState> => authenticated),
    })
    const stateChanged = vi.fn()
    render(<Onboarding state={ownerState} client={client} onStateChange={stateChanged} />)

    fireEvent.change(screen.getByLabelText('Family-visible name'), { target: { value: 'Owner Name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByText('Your family circle')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(await screen.findByText('Ready')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: label === 'Create Circle' ? 'Create my first circle' : 'Explore Family Circle' }))

    await waitFor(() => expect(client.completeOnboarding).toHaveBeenCalledWith(action))
    expect(stateChanged).toHaveBeenCalledWith(authenticated)
  })
})
