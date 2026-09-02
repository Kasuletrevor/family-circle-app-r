import { useState, type FormEvent } from 'react'
import type { AuthState } from '../../../shared/desktopApi'
import type { AuthClient } from '../../services/auth/AuthClient'

interface SignInFormProps {
  client: AuthClient
  initialEmail?: string
  onStateChange(state: AuthState): void
  onCreateAccount(): void
  onForgotPassword(email: string): void
}

export function SignInForm({
  client,
  initialEmail = '',
  onStateChange,
  onCreateAccount,
  onForgotPassword,
}: SignInFormProps) {
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      onStateChange(await client.signIn({ email, password }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-heading">
        <span className="auth-eyebrow">Private family workspace</span>
        <h1>Welcome back</h1>
        <p>Sign in to your Family Circle. Your private stories, documents and local AI stay on this device.</p>
      </div>

      {error && <div className="auth-alert" role="alert">{error}</div>}

      <label className="auth-field">
        <span>Email</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>

      <label className="auth-field">
        <span>Password</span>
        <div className="auth-password-field">
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button
            className="auth-password-toggle"
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>

      <button className="auth-primary" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <div className="auth-link-row">
        <button type="button" className="auth-link" onClick={() => onForgotPassword(email)}>
          Forgot password
        </button>
        <button type="button" className="auth-link auth-link--strong" onClick={onCreateAccount}>
          Create account
        </button>
      </div>
    </form>
  )
}
