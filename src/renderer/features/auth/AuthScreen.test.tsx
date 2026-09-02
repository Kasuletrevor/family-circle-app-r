import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuthClient } from '../../services/auth/AuthClient'
import { AuthScreen } from './AuthScreen'

function createClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    restore: vi.fn(),
    signIn: vi.fn(async () => ({ status: 'authenticated', user: {
      id: 1,
      email: 'member@example.com',
      name: 'Member',
      accountOrigin: 'existing',
      mustChangePassword: false,
      onboardingCompleted: true,
    } })),
    checkInvitation: vi.fn(async () => ({ hasPendingInvite: false, groupName: null, role: null })),
    register: vi.fn(async () => ({ status: 'onboarding', user: {
      id: 2,
      email: 'owner@example.com',
      name: 'Owner',
      accountOrigin: 'registered',
      mustChangePassword: false,
      onboardingCompleted: false,
    } })),
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(async () => ({
      success: true,
      message: 'If an account exists for that email, a recovery code has been sent.',
      expiresInMinutes: 10,
    })),
    resetPassword: vi.fn(async () => ({ success: true })),
    getOnboardingState: vi.fn(),
    setInitialPassword: vi.fn(),
    updateProfile: vi.fn(),
    getCircleContext: vi.fn(),
    completeOnboarding: vi.fn(),
    ...overrides,
  }
}

describe('AuthScreen', () => {
  it('signs in through the desktop client and surfaces a safe failure', async () => {
    const stateChanged = vi.fn()
    const client = createClient()
    const { rerender } = render(<AuthScreen client={client} onStateChange={stateChanged} />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' MEMBER@EXAMPLE.COM ' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: '123456789012' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(client.signIn).toHaveBeenCalledWith({
      email: ' MEMBER@EXAMPLE.COM ',
      password: '123456789012',
    }))
    expect(stateChanged).toHaveBeenCalled()

    const failing = createClient({ signIn: vi.fn(async () => { throw new Error('Incorrect password.') }) })
    rerender(<AuthScreen client={failing} onStateChange={stateChanged} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'member@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password.')
  })

  it('uses a three-step registration and redirects invited emails back to sign in', async () => {
    const invited = createClient({
      checkInvitation: vi.fn(async () => ({ hasPendingInvite: true, groupName: 'Kasule Family', role: 'Member' })),
    })
    render(<AuthScreen client={invited} onStateChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'New Member' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'invited@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('You already have a family invitation')).toBeInTheDocument()
    expect(screen.getByText(/Kasule Family/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Return to sign in' }))
    expect(screen.getByLabelText('Email')).toHaveValue('invited@example.com')
  })

  it('enforces password confirmation and registers only once after invitation recheck', async () => {
    const client = createClient()
    const stateChanged = vi.fn()
    render(<AuthScreen client={client} onStateChange={stateChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'New Owner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Create a password')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: '123456789012' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: '123456789013' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match')
    expect(client.register).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: '123456789012' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }))
    await waitFor(() => expect(client.register).toHaveBeenCalledTimes(1))
    expect(client.register).toHaveBeenCalledWith({ name: 'New Owner', email: 'owner@example.com', password: '123456789012' })
    expect(stateChanged).toHaveBeenCalled()
  })

  it('keeps recovery neutral and sends email, code and new password only on final reset', async () => {
    const client = createClient()
    render(<AuthScreen client={client} onStateChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'member@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' }))

    expect(await screen.findByText('If an account exists for that email, a recovery code has been sent.')).toBeInTheDocument()
    expect(client.requestPasswordReset).toHaveBeenCalledWith('member@example.com')

    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(client.resetPassword).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'abcdefghijkl' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'abcdefghijkl' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => expect(client.resetPassword).toHaveBeenCalledWith({
      email: 'member@example.com',
      code: '12345678',
      newPassword: 'abcdefghijkl',
    }))
    expect(await screen.findByText('Password reset')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Return to sign in' }))
    expect(screen.getByLabelText('Email')).toHaveValue('member@example.com')
  })
})
