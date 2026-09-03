import { useState, type FormEvent } from 'react'

interface ProfileStepProps {
  initialName: string
  busy: boolean
  error: string | null
  onSubmit(name: string): Promise<void>
}

export function ProfileStep({ initialName, busy, error, onSubmit }: ProfileStepProps) {
  const [name, setName] = useState(initialName)
  const [localError, setLocalError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const cleanName = name.trim()
    if (cleanName.length < 2) {
      setLocalError('Enter at least 2 characters for your family-visible name')
      return
    }
    setLocalError(null)
    await onSubmit(cleanName)
  }

  return (
    <form className="onboarding-step" onSubmit={submit}>
      <div className="onboarding-heading">
        <span className="auth-eyebrow">Step 2 of 4</span>
        <h1>Your profile</h1>
        <p>Choose the name your family will see in shared Circle experiences. Private stories and documents remain local unless you share them.</p>
      </div>
      {(localError || error) && <div className="auth-alert" role="alert">{localError || error}</div>}
      <label className="auth-field">
        <span>Family-visible name</span>
        <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <button className="auth-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
    </form>
  )
}
