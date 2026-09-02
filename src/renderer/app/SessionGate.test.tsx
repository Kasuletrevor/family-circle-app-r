import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuthState } from '../../shared/desktopApi'
import type { AuthClient } from '../services/auth/AuthClient'
import { SessionGate } from './SessionGate'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function clientWithRestore(restore: () => Promise<AuthState>): AuthClient {
  return {
    restore,
    signIn: vi.fn(),
    checkInvitation: vi.fn(),
    register: vi.fn(),
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    getOnboardingState: vi.fn(),
    setInitialPassword: vi.fn(),
    updateProfile: vi.fn(),
    getCircleContext: vi.fn(),
    completeOnboarding: vi.fn(),
  }
}

describe('SessionGate', () => {
  it('shows a branded restore state and never renders the shell before restore resolves', async () => {
    const pending = deferred<AuthState>()
    const client = clientWithRestore(() => pending.promise)

    render(
      <SessionGate
        client={client}
        renderUnauthenticated={() => <div>Auth front door</div>}
        renderOnboarding={() => <div>Onboarding</div>}
        renderAuthenticated={() => <div>Home shell</div>}
      />,
    )

    expect(screen.getByText('Family Circle')).toBeInTheDocument()
    expect(screen.getByText('Opening your private workspace...')).toBeInTheDocument()
    expect(screen.queryByText('Home shell')).not.toBeInTheDocument()

    pending.resolve({ status: 'authenticated', user: {
      id: 1,
      email: 'member@example.com',
      name: 'Member',
      accountOrigin: 'existing',
      mustChangePassword: false,
      onboardingCompleted: true,
    } })

    expect(await screen.findByText('Home shell')).toBeInTheDocument()
  })

  it.each([
    [{ status: 'unauthenticated' } as AuthState, 'Auth front door'],
    [{ status: 'onboarding', user: {
      id: 2,
      email: 'invited@example.com',
      name: 'Invited',
      accountOrigin: 'invited',
      mustChangePassword: true,
      onboardingCompleted: false,
    } } as AuthState, 'Onboarding'],
  ])('routes restored state to the correct front door', async (state, expected) => {
    render(
      <SessionGate
        client={clientWithRestore(async () => state)}
        renderUnauthenticated={() => <div>Auth front door</div>}
        renderOnboarding={() => <div>Onboarding</div>}
        renderAuthenticated={() => <div>Home shell</div>}
      />,
    )
    expect(await screen.findByText(expected)).toBeInTheDocument()
  })
})
