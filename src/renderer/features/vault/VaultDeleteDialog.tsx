interface VaultDeleteDialogProps {
  open: boolean
  fileName: string
  deleting: boolean
  onCancel(): void
  onConfirm(): void
}

export function VaultDeleteDialog({
  open,
  fileName,
  deleting,
  onCancel,
  onConfirm,
}: VaultDeleteDialogProps) {
  if (!open) return null

  const titleId = 'vault-delete-dialog-title'
  return (
    <div className="vault-dialog-backdrop" role="presentation">
      <section
        className="vault-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="vault-dialog__mark" aria-hidden="true">!</div>
        <div className="vault-dialog__copy">
          <h2 id={titleId}>Delete {fileName}?</h2>
          <p>This removes the local file and its Vault data from this computer.</p>
        </div>
        <div className="vault-dialog__actions">
          <button type="button" className="vault-button vault-button--secondary" disabled={deleting} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="vault-button vault-button--danger" disabled={deleting} onClick={onConfirm}>
            {deleting ? 'Deleting…' : 'Delete document'}
          </button>
        </div>
      </section>
    </div>
  )
}
