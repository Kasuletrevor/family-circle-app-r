import { useState, type FormEvent } from 'react'

interface PasswordStepProps {
  busy: boolean
  error: string | null
  onSubmit(password: string): Promise<void>
}

export function PasswordStep({ busy, error, onSubmit }: PasswordStepProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password.length < 12 || password.length > 72) {
      setLocalError('Password must be between 12 and 72 characters')
      return
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match')
      return
    }
    setLocalError(null)
    await onSubmit(password)
  }

  return (
    <form className="onboarding-step" onSubmit={submit}>
      <div className="onboarding-heading">
        <span className="auth-eyebrow">Step 1 of 4</span>
        <h1>Secure your account</h1>
        <p>Replace the temporary invitation password before anything else. Your new password stays protected on this device.</p>
      </div>
      {(localError || error) && <div className="auth-alert" role="alert">{localError || error}</div>}
      <label className="auth-field">
        <span>New password</span>
        <input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      <label className="auth-field">
        <span>Confirm password</span>
        <input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
      </label>
      <button className="auth-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
    </form>
  )
}
