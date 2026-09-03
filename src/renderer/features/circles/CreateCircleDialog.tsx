import { type FormEvent, useEffect, useState } from 'react'
import { useAppServices } from '../../app/services'

export interface CreateCircleDialogProps {
  open: boolean
  onClose(): void
  onCreated(circleId: string): void | Promise<void>
}

function createErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('name is required')) return 'Circle name is required.'
  if (message.includes('name is too long')) return 'Circle name is too long.'
  return "We couldn't create the Circle. Please try again."
}

export function CreateCircleDialog({ open, onClose, onCreated }: CreateCircleDialogProps) {
  const { circle } = useAppServices()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setName('')
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  if (!open) return null

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (submitting) return

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Circle name is required.')
      return
    }
    if (trimmedName.length > 120) {
      setError('Circle name is too long.')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const result = await circle.createCircle({ name: trimmedName })
      await onCreated(result.circleId)
      onClose()
    } catch (cause) {
      setError(createErrorMessage(cause))
      setSubmitting(false)
    }
  }

  return (
    <div className="circle-dialog-backdrop" role="presentation">
      <section
        className="circle-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-circle-title"
      >
        <header className="circle-dialog__header">
          <div>
            <p className="circle-dialog__eyebrow">Private family space</p>
            <h2 id="create-circle-title">Create a family circle</h2>
          </div>
          <button
            type="button"
            className="circle-dialog__close"
            aria-label="Close create Circle dialog"
            disabled={submitting}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form className="circle-dialog__form" onSubmit={(event) => void submit(event)}>
          <label className="circle-dialog__field">
            <span>Circle name</span>
            <input
              value={name}
              maxLength={121}
              autoFocus
              disabled={submitting}
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError(null)
              }}
            />
          </label>
          <p className="circle-dialog__hint">Private to invited members.</p>
          {error ? <div className="circle-dialog__error" role="alert">{error}</div> : null}

          <footer className="circle-dialog__actions">
            <button
              type="button"
              className="my-circles__secondary"
              disabled={submitting}
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="my-circles__primary" type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create Circle'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
