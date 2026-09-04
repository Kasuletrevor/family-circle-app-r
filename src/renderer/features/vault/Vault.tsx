import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, FileText, LockKeyhole, RefreshCw, Trash2, Upload } from 'lucide-react'
import type { VaultDocumentSummary, VaultIndexStatus, VaultUploadProgress } from '../../../shared/desktopApi'
import { DesktopVaultClient } from '../../services/vault/DesktopVaultClient'
import type { VaultClient } from '../../services/vault/VaultClient'
import { VaultDeleteDialog } from './VaultDeleteDialog'
import './Vault.css'

const defaultVaultClient = new DesktopVaultClient()

type LoadState =
  | { status: 'loading'; documents: VaultDocumentSummary[] }
  | { status: 'ready'; documents: VaultDocumentSummary[] }
  | { status: 'error'; documents: VaultDocumentSummary[] }

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(sizeBytes % 1024 === 0 ? 0 : 1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function wordLabel(wordCount: number): string {
  return `${wordCount} ${wordCount === 1 ? 'word' : 'words'}`
}

function indexStatusLabel(status: VaultIndexStatus): string {
  switch (status) {
    case 'waiting_for_ai':
      return 'Ready for Private AI'
    case 'indexing':
      return 'Indexing...'
    case 'indexed':
      return 'Ready to ask'
    case 'failed':
      return 'AI indexing failed'
    default:
      return 'Not indexed yet'
  }
}

function documentStatus(document: VaultDocumentSummary): string {
  if (document.extractionStatus === 'failed') return 'Stored, but text could not be extracted'
  if (document.extractionStatus === 'extracting') return 'Extracting text...'
  if (document.extractionStatus === 'pending') return 'Preparing document...'
  return indexStatusLabel(document.indexStatus)
}

function progressStageLabel(progress: VaultUploadProgress): string {
  switch (progress.stage) {
    case 'validating':
      return 'Validating'
    case 'saving':
      return 'Saving privately'
    case 'extracting':
      return 'Extracting text'
    default:
      return 'Finishing'
  }
}

function statusTone(document: VaultDocumentSummary): string {
  if (document.extractionStatus === 'failed' || document.indexStatus === 'failed') return 'error'
  if (document.indexStatus === 'indexed') return 'ready'
  if (document.indexStatus === 'waiting_for_ai') return 'waiting'
  return 'neutral'
}

export function Vault({ client = defaultVaultClient }: { client?: VaultClient }) {
  const [reloadVersion, setReloadVersion] = useState(0)
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading', documents: [] })
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<VaultUploadProgress | null>(null)
  const [retryingId, setRetryingId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<VaultDocumentSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadState((current) => ({ status: 'loading', documents: current.documents }))

    void client.listDocuments().then(
      (documents) => {
        if (!cancelled) setLoadState({ status: 'ready', documents })
      },
      () => {
        if (!cancelled) setLoadState((current) => ({ status: 'error', documents: current.documents }))
      },
    )

    return () => {
      cancelled = true
    }
  }, [client, reloadVersion])

  useEffect(() => client.onUploadProgress((progress) => {
    setUploadProgress(progress)
  }), [client])

  const documents = loadState.documents
  const failedExtractionCount = useMemo(
    () => documents.filter((document) => document.extractionStatus === 'failed').length,
    [documents],
  )

  async function uploadDocuments(): Promise<void> {
    if (uploading) return
    setUploading(true)
    setUploadProgress(null)
    setNotice(null)
    setError(null)
    try {
      const result = await client.chooseAndUploadDocuments()
      if (!result.canceled) {
        const duplicates = result.items.filter((item) => item.outcome === 'already-exists').length
        const failed = result.items.filter((item) => !['uploaded', 'already-exists'].includes(item.outcome)).length
        if (failed > 0) {
          setNotice(`${failed} document${failed === 1 ? '' : 's'} could not be added. Other selected files were kept.`)
        } else if (duplicates > 0) {
          setNotice(`${duplicates} exact duplicate${duplicates === 1 ? ' was' : 's were'} already in your Vault.`)
        }
      }
    } catch {
      setError('Your documents could not be added. Please try again.')
    } finally {
      setUploading(false)
      setUploadProgress(null)
      setReloadVersion((value) => value + 1)
    }
  }

  async function openDocument(document: VaultDocumentSummary): Promise<void> {
    setError(null)
    try {
      await client.openDocument(document.id)
    } catch {
      setError(`${document.fileName} could not be opened. Please try again.`)
    }
  }

  async function retryExtraction(document: VaultDocumentSummary): Promise<void> {
    if (retryingId !== null) return
    setRetryingId(document.id)
    setError(null)
    try {
      await client.retryExtraction(document.id)
    } catch {
      setError(`${document.fileName} could not be reprocessed. Please try again.`)
    } finally {
      setRetryingId(null)
      setReloadVersion((value) => value + 1)
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || deleting) return
    const target = deleteTarget
    setDeleting(true)
    setError(null)
    try {
      await client.deleteDocument(target.id)
      setDeleteTarget(null)
      setReloadVersion((value) => value + 1)
    } catch {
      setError(`${target.fileName} could not be deleted. Please try again.`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <section className="vault-page" aria-labelledby="vault-title">
        <header className="vault-header">
          <div className="vault-header__copy">
            <div className="vault-eyebrow"><LockKeyhole size={14} aria-hidden="true" /> Private on this device</div>
            <h1 id="vault-title">Vault</h1>
            <p>Your private documents stay on this computer.</p>
          </div>
          <button
            className="vault-button vault-button--primary"
            type="button"
            disabled={uploading}
            onClick={() => void uploadDocuments()}
          >
            <Upload size={17} aria-hidden="true" />
            {uploading ? 'Uploading…' : 'Upload documents'}
          </button>
        </header>

        <div className="vault-privacy-note">
          <LockKeyhole size={18} aria-hidden="true" />
          <div>
            <strong>Local by design</strong>
            <span>PDF, DOCX and TXT files are stored and read locally. Private AI can be added later without blocking your Vault.</span>
          </div>
        </div>

        {uploadProgress ? (
          <div className="vault-progress" role="status" aria-live="polite">
            <div className="vault-progress__copy">
              <strong>{uploadProgress.fileName}</strong>
              <span>{progressStageLabel(uploadProgress)} · File {uploadProgress.fileIndex} of {uploadProgress.fileCount}</span>
            </div>
            <div className="vault-progress__meter" aria-hidden="true">
              <span style={{ width: `${Math.max(0, Math.min(100, uploadProgress.percent))}%` }} />
            </div>
            <strong className="vault-progress__percent">{uploadProgress.percent}%</strong>
          </div>
        ) : null}

        {error ? <div className="vault-alert vault-alert--error" role="alert">{error}</div> : null}
        {notice ? <div className="vault-alert" role="status">{notice}</div> : null}

        <div className="vault-section-heading">
          <div>
            <h2>Documents</h2>
            <p>{documents.length} stored locally{failedExtractionCount ? ` · ${failedExtractionCount} needs attention` : ''}</p>
          </div>
        </div>

        {loadState.status === 'loading' && documents.length === 0 ? (
          <div className="vault-state" role="status">Loading your private documents…</div>
        ) : null}

        {loadState.status === 'error' ? (
          <div className="vault-state vault-state--error" role="alert">
            <h2>We couldn't load your Vault.</h2>
            <p>Your files have not been removed.</p>
            <button className="vault-button vault-button--secondary" type="button" onClick={() => setReloadVersion((value) => value + 1)}>
              Try again
            </button>
          </div>
        ) : null}

        {loadState.status === 'ready' && documents.length === 0 ? (
          <div className="vault-state vault-state--empty">
            <div className="vault-state__mark" aria-hidden="true"><FileText size={26} /></div>
            <h2>No documents in your Vault yet.</h2>
            <p>Add family records, letters or notes. They remain private to your local account on this computer.</p>
            <button className="vault-button vault-button--secondary" aria-label="Add documents" type="button" disabled={uploading} onClick={() => void uploadDocuments()}>
              <Upload size={16} aria-hidden="true" /> Upload documents
            </button>
          </div>
        ) : null}

        {documents.length > 0 ? (
          <div className="vault-list">
            {documents.map((document) => (
              <article className="vault-document" key={document.id}>
                <div className="vault-document__icon" aria-hidden="true"><FileText size={23} /></div>
                <div className="vault-document__body">
                  <div className="vault-document__title-row">
                    <div>
                      <h3>{document.fileName}</h3>
                      <div className="vault-document__meta">
                        <span>{document.fileType.toUpperCase()}</span>
                        <span>{formatBytes(document.sizeBytes)}</span>
                        <span>{wordLabel(document.wordCount)}</span>
                      </div>
                    </div>
                    <span className={`vault-status vault-status--${statusTone(document)}`}>{documentStatus(document)}</span>
                  </div>
                  {document.preview ? <p className="vault-document__preview">{document.preview}</p> : null}
                  <div className="vault-document__actions">
                    <button className="vault-action" type="button" aria-label={`Open ${document.fileName}`} onClick={() => void openDocument(document)}>
                      <ExternalLink size={15} aria-hidden="true" /> Open
                    </button>
                    {document.extractionStatus === 'failed' ? (
                      <button
                        className="vault-action"
                        type="button"
                        aria-label={`Retry extraction ${document.fileName}`}
                        disabled={retryingId !== null}
                        onClick={() => void retryExtraction(document)}
                      >
                        <RefreshCw size={15} aria-hidden="true" />
                        {retryingId === document.id ? 'Retrying…' : 'Retry extraction'}
                      </button>
                    ) : null}
                    <button className="vault-action vault-action--danger" type="button" aria-label={`Delete ${document.fileName}`} onClick={() => setDeleteTarget(document)}>
                      <Trash2 size={15} aria-hidden="true" /> Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <VaultDeleteDialog
        open={deleteTarget !== null}
        fileName={deleteTarget?.fileName ?? ''}
        deleting={deleting}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        onConfirm={() => void confirmDelete()}
      />
    </>
  )
}
