import { useEffect, useState } from 'react'
import './CircleDialog.css'

export interface ConfirmCircleActionDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  busyLabel: string
  onCancel(): void
  onConfirm(): Promise<void>
}

export function ConfirmCircleActionDialog({
  open,
  title,
  message,
  confirmLabel,
  busyLabel,
  onCancel,
  onConfirm,
}: ConfirmCircleActionDialogProps) {
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) setBusy(false)
  }, [open])

  if (!open) return null

  async function confirm(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="circle-dialog-backdrop" role="presentation">
      <section className="circle-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="circle-dialog__header">
          <div>
            <p className="circle-dialog__eyebrow">Confirm action</p>
            <h2>{title}</h2>
          </div>
        </header>
        <div className="circle-dialog__form">
          <p className="circle-dialog__hint">{message}</p>
          <footer className="circle-dialog__actions">
            <button type="button" className="my-circles__secondary" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="circle-management__danger" disabled={busy} onClick={() => void confirm()}>
              {busy ? busyLabel : confirmLabel}
            </button>
          </footer>
        </div>
      </section>
    </div>
  )
}
