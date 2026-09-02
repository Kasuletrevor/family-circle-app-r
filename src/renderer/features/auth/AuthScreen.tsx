import { useState } from 'react'
import type { AuthState } from '../../../shared/desktopApi'
import { BrandMark } from '../../design-system/BrandMark'
import type { AuthClient } from '../../services/auth/AuthClient'
import { RecoveryFlow } from './RecoveryFlow'
import { RegisterFlow } from './RegisterFlow'
import { SignInForm } from './SignInForm'
import './Auth.css'

type AuthMode = 'sign-in' | 'register' | 'recover'

interface AuthScreenProps {
  client: AuthClient
  onStateChange(state: AuthState): void
}

export function AuthScreen({ client, onStateChange }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [prefilledEmail, setPrefilledEmail] = useState('')

  function returnToSignIn(email?: string) {
    if (email) setPrefilledEmail(email)
    setMode('sign-in')
  }

  return (
    <main className="auth-screen">
      <section className="auth-brand-panel" aria-label="Kin-Keepers Family Circle">
        <BrandMark />
        <div className="auth-brand-copy">
          <span className="auth-brand-kicker">Family Circle</span>
          <h2>A private place for the people and stories that matter.</h2>
          <p>
            Keep personal memories, documents and local AI private on your device while connecting to the family circles you choose to share.
          </p>
        </div>
        <div className="auth-privacy-card">
          <strong>Private by design</strong>
          <span>Local stories · protected sessions · deliberate sharing</span>
        </div>
      </section>

      <section className="auth-card" aria-label="Family Circle account">
        {mode === 'sign-in' && (
          <SignInForm
            key={`sign-in-${prefilledEmail}`}
            client={client}
            initialEmail={prefilledEmail}
            onStateChange={onStateChange}
            onCreateAccount={() => setMode('register')}
            onForgotPassword={(email) => {
              if (email) setPrefilledEmail(email)
              setMode('recover')
            }}
          />
        )}
        {mode === 'register' && (
          <RegisterFlow client={client} onStateChange={onStateChange} onReturnToSignIn={returnToSignIn} />
        )}
        {mode === 'recover' && (
          <RecoveryFlow client={client} initialEmail={prefilledEmail} onReturnToSignIn={returnToSignIn} />
        )}
      </section>
    </main>
  )
}
