import { useEffect, useMemo, useState } from 'react'
import { BrainCircuit, ExternalLink, FileText, LockKeyhole, Pause, Play, RefreshCw, Trash2, Upload, Wrench } from 'lucide-react'
import type { VaultDocumentSummary, VaultIndexStatus, VaultUploadProgress } from '../../../shared/desktopApi'
import { DesktopPrivateAiClient } from '../../services/ai/DesktopPrivateAiClient'
import type { PrivateAiClient, PrivateAiProgress, PrivateAiStatus } from '../../services/ai/PrivateAiClient'
import { DesktopVaultClient } from '../../services/vault/DesktopVaultClient'
import type { VaultClient } from '../../services/vault/VaultClient'
import { PrivateAiSetupProgress } from '../private-ai/PrivateAiSetupProgress'
import { downloadSizeLabel } from '../private-ai/setupProgress'
import { VaultDeleteDialog } from './VaultDeleteDialog'
import './Vault.css'
import './Vault.privateAi.css'

const defaultVaultClient = new DesktopVaultClient()
const defaultPrivateAiClient = new DesktopPrivateAiClient()

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
  const progress = document.indexStatus === 'indexing' ? document.indexProgress : null
  if (progress) {
    const percent = Math.floor((progress.done / progress.total) * 100)
    return `Indexing… ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} sections (${percent}%)`
  }
  return indexStatusLabel(document.indexStatus)
}

const INDEX_REFRESH_MS = 2_000

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

function privateAiTitle(status: PrivateAiStatus): string {
  switch (status.state) {
    case 'not_installed': return 'Private AI is optional'
    case 'downloading': return 'Downloading Private AI'
    case 'paused': return 'Private AI setup paused'
    case 'verifying': return 'Verifying Private AI'
    case 'ready': return 'Private AI is ready'
    case 'repair_required': return 'Private AI needs repair'
    case 'failed': return 'Private AI setup failed'
  }
}

function statusFromProgress(progress: PrivateAiProgress, previous: PrivateAiStatus | null): PrivateAiStatus {
  return {
    state: progress.state,
    ready: progress.state === 'ready',
    repairRequired: progress.state === 'repair_required',
    // Progress totals cover only the files being downloaded; keep the install size.
    totalSizeBytes: previous?.totalSizeBytes ?? progress.totalSizeBytes,
    downloadSizeBytes: progress.state === 'downloading' && progress.totalSizeBytes > 0
      ? Math.max(0, progress.totalSizeBytes - progress.bytesDownloaded)
      : previous?.downloadSizeBytes,
    version: previous?.version ?? '',
    message: progress.message,
  }
}

export function Vault({
  client = defaultVaultClient,
  privateAiClient = defaultPrivateAiClient,
}: {
  client?: VaultClient
  privateAiClient?: PrivateAiClient
}) {
  const [reloadVersion, setReloadVersion] = useState(0)
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading', documents: [] })
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<VaultUploadProgress | null>(null)
  const [retryingId, setRetryingId] = useState<number | null>(null)
  const [indexingId, setIndexingId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<VaultDocumentSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [privateAiStatus, setPrivateAiStatus] = useState<PrivateAiStatus | null>(null)
  const [privateAiProgress, setPrivateAiProgress] = useState<PrivateAiProgress | null>(null)
  const [privateAiBusy, setPrivateAiBusy] = useState(false)
  const [privateAiPauseBusy, setPrivateAiPauseBusy] = useState(false)
  const [privateAiError, setPrivateAiError] = useState<string | null>(null)

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

  // Large documents take minutes to index; refresh quietly so progress and completion show up.
  const indexingActive = loadState.documents.some((document) => document.indexStatus === 'indexing'
    || (document.indexStatus === 'waiting_for_ai' && document.extractionStatus === 'ready' && privateAiStatus?.ready === true))
  useEffect(() => {
    if (!indexingActive) return
    let cancelled = false
    const timer = setInterval(() => {
      void client.listDocuments().then(
        (documents) => { if (!cancelled) setLoadState({ status: 'ready', documents }) },
        () => undefined,
      )
    }, INDEX_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [client, indexingActive])

  useEffect(() => client.onUploadProgress((progress) => {
    setUploadProgress(progress)
  }), [client])

  useEffect(() => {
    let cancelled = false
    let unsubscribe: () => void = () => undefined
    void privateAiClient.getStatus().then(
      (status) => {
        if (!cancelled) setPrivateAiStatus(status)
      },
      () => {
        if (!cancelled) setPrivateAiStatus(null)
      },
    )

    try {
      unsubscribe = privateAiClient.onProgress((progress) => {
        if (cancelled) return
        setPrivateAiProgress(progress)
        setPrivateAiStatus((current) => statusFromProgress(progress, current))
        if (progress.state === 'ready') setReloadVersion((value) => value + 1)
      })
    } catch {
      // Older/non-desktop test hosts may not expose the optional Private AI bridge.
    }

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [privateAiClient])

  const documents = loadState.documents
  const privateAiDownloadLabel = privateAiStatus ? downloadSizeLabel(privateAiStatus) : null
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

  async function retryIndexing(document: VaultDocumentSummary): Promise<void> {
    if (indexingId !== null) return
    setIndexingId(document.id)
    setError(null)
    try {
      await client.retryIndexing(document.id)
    } catch {
      setError(`${document.fileName} could not be indexed. Please try again.`)
    } finally {
      setIndexingId(null)
      setReloadVersion((value) => value + 1)
    }
  }

  async function runPrivateAiAction(action: 'start' | 'pause' | 'repair'): Promise<void> {
    const isPause = action === 'pause'
    if (isPause ? privateAiPauseBusy : privateAiBusy) return

    if (isPause) setPrivateAiPauseBusy(true)
    else setPrivateAiBusy(true)
    setPrivateAiError(null)
    try {
      const status = action === 'start'
        ? await privateAiClient.startSetup()
        : isPause
          ? await privateAiClient.pauseSetup()
          : await privateAiClient.repair()
      setPrivateAiStatus(status)
      if (status.state !== 'downloading' && status.state !== 'verifying') {
        setPrivateAiProgress(null)
      }
      if (status.ready) setReloadVersion((value) => value + 1)
    } catch {
      setPrivateAiError('Private AI setup could not continue. Please try again.')
    } finally {
      if (isPause) setPrivateAiPauseBusy(false)
      else setPrivateAiBusy(false)
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
            <span>PDF, DOCX and TXT files are stored and read locally. Upload never depends on Private AI setup.</span>
          </div>
        </div>

        {privateAiStatus ? (
          <section className={`vault-ai vault-ai--${privateAiStatus.state}`} aria-label="Private AI setup">
            <div className="vault-ai__mark" aria-hidden="true"><BrainCircuit size={21} /></div>
            <div className="vault-ai__body">
              <div className="vault-ai__heading">
                <div>
                  <strong>{privateAiTitle(privateAiStatus)}</strong>
                  {privateAiStatus.state === 'not_installed' ? (
                    <p>Your documents are already stored privately. Set up Private AI to search them semantically and ask questions without sending them online.</p>
                  ) : privateAiStatus.state === 'ready' ? (
                    <p>Semantic search is available locally. Documents waiting for AI will be indexed in the background.</p>
                  ) : privateAiStatus.state === 'repair_required' ? (
                    <p>The local AI files could not be verified. Repair will re-check and restore only the required local components.</p>
                  ) : privateAiStatus.state === 'failed' ? (
                    <p>Setup did not complete. Your Vault documents are still stored safely and can still be opened or uploaded.</p>
                  ) : null}
                </div>
                <div className="vault-ai__actions">
                  {privateAiStatus.state === 'not_installed' ? (
                    <button className="vault-button vault-button--secondary" type="button" disabled={privateAiBusy} onClick={() => void runPrivateAiAction('start')}>
                      <Play size={14} aria-hidden="true" /> Set up Private AI
                    </button>
                  ) : null}
                  {privateAiStatus.state === 'downloading' ? (
                    <button className="vault-button vault-button--secondary" type="button" disabled={privateAiPauseBusy} onClick={() => void runPrivateAiAction('pause')}>
                      <Pause size={14} aria-hidden="true" /> Pause setup
                    </button>
                  ) : null}
                  {privateAiStatus.state === 'paused' ? (
                    <button className="vault-button vault-button--secondary" type="button" disabled={privateAiBusy} onClick={() => void runPrivateAiAction('start')}>
                      <Play size={14} aria-hidden="true" /> Continue setup
                    </button>
                  ) : null}
                  {privateAiStatus.state === 'repair_required' || privateAiStatus.state === 'failed' ? (
                    <button className="vault-button vault-button--secondary" type="button" disabled={privateAiBusy} onClick={() => void runPrivateAiAction('repair')}>
                      <Wrench size={14} aria-hidden="true" /> Repair Private AI
                    </button>
                  ) : null}
                </div>
              </div>

              {privateAiDownloadLabel ? <span className="vault-ai__detail">{privateAiDownloadLabel}</span> : null}
              {privateAiStatus.state === 'not_installed' ? (
                <span className="vault-ai__detail">Works offline after setup. You can pause and resume anytime.</span>
              ) : null}

              <PrivateAiSetupProgress state={privateAiStatus.state} progress={privateAiProgress} />

              {privateAiStatus.state === 'paused' ? <span className="vault-ai__detail">Resume whenever you choose. Your partial download stays on this computer.</span> : null}
              {privateAiError ? <div className="vault-ai__error" role="alert">{privateAiError}</div> : null}
            </div>
          </section>
        ) : null}

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
                  {document.indexStatus === 'indexing' && document.indexProgress ? (
                    <div
                      className="vault-progress__meter"
                      role="progressbar"
                      aria-label={`Indexing ${document.fileName}`}
                      aria-valuemin={0}
                      aria-valuemax={document.indexProgress.total}
                      aria-valuenow={document.indexProgress.done}
                    >
                      <span style={{ width: `${(document.indexProgress.done / document.indexProgress.total) * 100}%` }} />
                    </div>
                  ) : null}
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
                    {document.extractionStatus === 'ready' && document.indexStatus === 'failed' ? (
                      <button
                        className="vault-action"
                        type="button"
                        aria-label={`Retry indexing ${document.fileName}`}
                        disabled={indexingId !== null}
                        onClick={() => void retryIndexing(document)}
                      >
                        <RefreshCw size={15} aria-hidden="true" />
                        {indexingId === document.id ? 'Indexing…' : 'Retry indexing'}
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
