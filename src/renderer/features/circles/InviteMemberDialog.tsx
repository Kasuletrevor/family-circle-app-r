import { type FormEvent, useEffect, useState } from 'react'
import {
  INVITATION_FAMILY_ROLES,
  type InvitationFamilyRole,
  type InviteMemberResult,
} from '../../../shared/desktopApi'
import { useAppServices } from '../../app/services'
import './CircleDialog.css'

export interface InviteMemberDialogProps {
  open: boolean
  circleId: string
  circleName: string
  onClose(): void
  onInvited(outcome: InviteMemberResult['outcome']): void | Promise<void>
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function outcomeMessage(outcome: InviteMemberResult['outcome']): string {
  switch (outcome) {
    case 'sent': return 'Invitation sent.'
    case 'already-pending': return 'An invitation is already pending.'
    case 'already-member': return 'This person is already a member.'
    case 'delivery-failed': return 'The invitation was created, but email delivery failed.'
  }
}

export function InviteMemberDialog({
  open,
  circleId,
  circleName,
  onClose,
  onInvited,
}: InviteMemberDialogProps) {
  const { circle } = useAppServices()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitationFamilyRole>(INVITATION_FAMILY_ROLES[0])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setEmail('')
      setRole(INVITATION_FAMILY_ROLES[0])
      setError(null)
      setResult(null)
      setSubmitting(false)
    }
  }, [open])

  if (!open) return null

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (submitting) return

    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError('Enter a valid email address.')
      setResult(null)
      return
    }

    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const response = await circle.inviteMember({
        circleId,
        email: normalizedEmail,
        role,
      })
      setResult(outcomeMessage(response.outcome))
      await onInvited(response.outcome)
      setSubmitting(false)
    } catch {
      setError("We couldn't send the invitation. Please try again.")
      setSubmitting(false)
    }
  }

  return (
    <div className="circle-dialog-backdrop" role="presentation">
      <section
        className="circle-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-member-title"
      >
        <header className="circle-dialog__header">
          <div>
            <p className="circle-dialog__eyebrow">Family invitation</p>
            <h2 id="invite-member-title">Invite someone to {circleName}</h2>
          </div>
          <button
            type="button"
            className="circle-dialog__close"
            aria-label="Close invite member dialog"
            disabled={submitting}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form className="circle-dialog__form" noValidate onSubmit={(event) => void submit(event)}>
          <label className="circle-dialog__field">
            <span>Email address</span>
            <input
              type="email"
              value={email}
              autoFocus
              disabled={submitting}
              onChange={(event) => {
                setEmail(event.target.value)
                setError(null)
                setResult(null)
              }}
            />
          </label>

          <label className="circle-dialog__field">
            <span>Relationship</span>
            <select
              value={role}
              disabled={submitting}
              onChange={(event) => {
                setRole(event.target.value as InvitationFamilyRole)
                setError(null)
                setResult(null)
              }}
            >
              {INVITATION_FAMILY_ROLES.map((familyRole) => (
                <option value={familyRole} key={familyRole}>{familyRole}</option>
              ))}
            </select>
          </label>

          <p className="circle-dialog__hint">Relationship describes this person's place in the family. Circle ownership is managed separately.</p>
          {error ? <div className="circle-dialog__error" role="alert">{error}</div> : null}
          {result ? <div className="circle-dialog__result" role="status">{result}</div> : null}

          <footer className="circle-dialog__actions">
            <button
              type="button"
              className="my-circles__secondary"
              disabled={submitting}
              onClick={onClose}
            >
              Close
            </button>
            <button className="my-circles__primary" type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send invitation'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
