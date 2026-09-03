import { useState, type FormEvent } from 'react'
import type { AuthClient } from '../../services/auth/AuthClient'

type RecoveryStep = 'email' | 'code' | 'password' | 'complete'

interface RecoveryFlowProps {
  client: AuthClient
  initialEmail?: string
  onReturnToSignIn(email?: string): void
}

export function RecoveryFlow({ client, initialEmail = '', onReturnToSignIn }: RecoveryFlowProps) {
  const [step, setStep] = useState<RecoveryStep>('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function requestCode(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await client.requestPasswordReset(email)
      setMessage(result.message)
      setStep('code')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start password recovery. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function continueCode(event: FormEvent) {
    event.preventDefault()
    if (!/^\d{8}$/.test(code.trim())) {
      setError('Enter the 8-digit recovery code')
      return
    }
    setError(null)
    setStep('password')
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (newPassword.length < 12 || newPassword.length > 72) {
      setError('Password must be between 12 and 72 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setBusy(true)
    try {
      await client.resetPassword({ email, code: code.trim(), newPassword })
      setStep('complete')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reset your password. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (step === 'complete') {
    return (
      <section className="auth-form" aria-live="polite">
        <div className="auth-success-mark" aria-hidden="true">✓</div>
        <div className="auth-heading auth-heading--center">
          <span className="auth-eyebrow">Account secured</span>
          <h1>Password reset</h1>
          <p>Your password has been changed and older protected sessions have been invalidated.</p>
        </div>
        <button className="auth-primary" type="button" onClick={() => onReturnToSignIn(email)}>
          Return to sign in
        </button>
      </section>
    )
  }

  return (
    <form
      className="auth-form"
      onSubmit={step === 'email' ? requestCode : step === 'code' ? continueCode : resetPassword}
    >
      <div className="auth-heading">
        <span className="auth-eyebrow">Secure recovery</span>
        <h1>{step === 'password' ? 'Choose a new password' : 'Reset your password'}</h1>
        <p>
          {step === 'email' && 'Enter your account email. We’ll respond the same way whether or not an account exists.'}
          {step === 'code' && 'Enter the one-time recovery code from your email.'}
          {step === 'password' && 'Choose a new password between 12 and 72 characters.'}
        </p>
      </div>

      {message && <div className="auth-notice" role="status">{message}</div>}
      {error && <div className="auth-alert" role="alert">{error}</div>}

      {step === 'email' && (
        <label className="auth-field">
          <span>Email</span>
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
      )}

      {step === 'code' && (
        <label className="auth-field">
          <span>Recovery code</span>
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} required />
        </label>
      )}

      {step === 'password' && (
        <>
          <label className="auth-field">
            <span>New password</span>
            <input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
          </label>
          <label className="auth-field">
            <span>Confirm new password</span>
            <input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
          </label>
        </>
      )}

      <button className="auth-primary" type="submit" disabled={busy}>
        {busy ? 'Working…' : step === 'email' ? 'Send recovery code' : step === 'code' ? 'Continue' : 'Reset password'}
      </button>
      <button className="auth-link auth-link--center" type="button" onClick={() => onReturnToSignIn(email || undefined)}>
        Back to sign in
      </button>
    </form>
  )
}
