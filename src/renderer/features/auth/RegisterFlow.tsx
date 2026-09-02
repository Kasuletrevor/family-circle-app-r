import { useState, type FormEvent } from 'react'
import type { AuthState, InvitationCheckResult } from '../../../shared/desktopApi'
import type { AuthClient } from '../../services/auth/AuthClient'

type RegistrationStep = 'name' | 'email' | 'password' | 'invited'

interface RegisterFlowProps {
  client: AuthClient
  onStateChange(state: AuthState): void
  onReturnToSignIn(email?: string): void
}

export function RegisterFlow({ client, onStateChange, onReturnToSignIn }: RegisterFlowProps) {
  const [step, setStep] = useState<RegistrationStep>('name')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [invitation, setInvitation] = useState<InvitationCheckResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function continueName(event: FormEvent) {
    event.preventDefault()
    const cleanName = name.trim()
    if (cleanName.length < 2) {
      setError('Enter the name you want your family to see')
      return
    }
    setName(cleanName)
    setError(null)
    setStep('email')
  }

  async function continueEmail(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await client.checkInvitation(email)
      if (result.hasPendingInvite) {
        setInvitation(result)
        setStep('invited')
      } else {
        setStep('password')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not check this email. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (password.length < 12 || password.length > 72) {
      setError('Password must be between 12 and 72 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setBusy(true)
    try {
      onStateChange(await client.register({ name, email, password }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create your account. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (step === 'invited') {
    return (
      <section className="auth-form" aria-live="polite">
        <div className="auth-heading">
          <span className="auth-eyebrow">Invitation found</span>
          <h1>You already have a family invitation</h1>
          <p>
            Sign in with the temporary password from your invitation email
            {invitation?.groupName ? <> to join <strong>{invitation.groupName}</strong></> : null}
            {invitation?.role ? <> as {invitation.role}</> : null}.
          </p>
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
      onSubmit={step === 'name' ? continueName : step === 'email' ? continueEmail : createAccount}
    >
      <div className="auth-heading">
        <span className="auth-eyebrow">Create your private account</span>
        <h1>{step === 'password' ? 'Create a password' : 'Create your account'}</h1>
        <p>
          {step === 'name' && 'Start with the name your family will recognise.'}
          {step === 'email' && 'We’ll check whether your family has already invited this email.'}
          {step === 'password' && 'Use 12–72 characters. Your password is stored only as a secure hash.'}
        </p>
      </div>

      <div className="auth-progress" aria-label="Registration progress">
        <span className={step === 'name' ? 'is-active' : 'is-complete'}>1</span>
        <span className={step === 'email' ? 'is-active' : step === 'password' ? 'is-complete' : ''}>2</span>
        <span className={step === 'password' ? 'is-active' : ''}>3</span>
      </div>

      {error && <div className="auth-alert" role="alert">{error}</div>}

      {step === 'name' && (
        <label className="auth-field">
          <span>Your name</span>
          <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
      )}

      {step === 'email' && (
        <label className="auth-field">
          <span>Email</span>
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
      )}

      {step === 'password' && (
        <>
          <label className="auth-field">
            <span>Password</span>
            <input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <label className="auth-field">
            <span>Confirm password</span>
            <input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
          </label>
        </>
      )}

      <button className="auth-primary" type="submit" disabled={busy}>
        {busy ? 'Checking…' : step === 'password' ? 'Create my account' : 'Continue'}
      </button>
      <button className="auth-link auth-link--center" type="button" onClick={() => onReturnToSignIn(email || undefined)}>
        Back to sign in
      </button>
    </form>
  )
}
