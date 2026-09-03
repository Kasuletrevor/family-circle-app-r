import { useEffect, useState, type ReactNode } from 'react'
import type { AuthState } from '../../shared/desktopApi'
import type { AuthClient } from '../services/auth/AuthClient'
import { BrandMark } from '../design-system/BrandMark'

type StateUpdater = (next: AuthState) => void

interface SessionGateProps {
  client: AuthClient
  renderUnauthenticated(onStateChange: StateUpdater): ReactNode
  renderOnboarding(state: Extract<AuthState, { status: 'onboarding' }>, onStateChange: StateUpdater): ReactNode
  renderAuthenticated(state: Extract<AuthState, { status: 'authenticated' }>, onStateChange: StateUpdater): ReactNode
}

export function SessionGate({
  client,
  renderUnauthenticated,
  renderOnboarding,
  renderAuthenticated,
}: SessionGateProps) {
  const [state, setState] = useState<AuthState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void client.restore()
      .then((restored) => {
        if (active) setState(restored)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : 'Could not open your private workspace.')
      })
    return () => { active = false }
  }, [client])

  if (error) {
    return (
      <main className="session-gate" role="alert">
        <BrandMark />
        <h1>Family Circle</h1>
        <p>{error}</p>
        <button type="button" onClick={() => window.location.reload()}>Try again</button>
      </main>
    )
  }

  if (!state) {
    return (
      <main className="session-gate" aria-live="polite">
        <BrandMark />
        <h1>Family Circle</h1>
        <p>Opening your private workspace...</p>
      </main>
    )
  }

  if (state.status === 'unauthenticated') return <>{renderUnauthenticated(setState)}</>
  if (state.status === 'onboarding') return <>{renderOnboarding(state, setState)}</>
  return <>{renderAuthenticated(state, setState)}</>
}
