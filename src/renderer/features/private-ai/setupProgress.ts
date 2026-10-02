import type { PrivateAiProgress, PrivateAiStatus } from '../../services/ai/PrivateAiClient'

export function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0 B'
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(sizeBytes % 1024 === 0 ? 0 : 1)} KB`
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function approximateMegabytes(sizeBytes: number): string {
  return `${Math.max(1, Math.round(sizeBytes / (1024 * 1024)))} MB`
}

export function formatEta(seconds: number): string {
  const totalSeconds = Math.max(1, Math.ceil(seconds))
  if (totalSeconds < 60) return `${totalSeconds} sec`

  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  if (minutes < 60) return remainingSeconds === 0 ? `${minutes} min` : `${minutes} min ${remainingSeconds} sec`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes === 0 ? `${hours} hr` : `${hours} hr ${remainingMinutes} min`
}

/** Bytes still to download; older statuses (and offline voice) only report the full size. */
function pendingBytes(status: PrivateAiStatus): number {
  return status.downloadSizeBytes ?? status.totalSizeBytes
}

/**
 * What setup or repair will download, shown before the user starts it. A repair
 * after an engine upgrade needs only the engine, not the full install.
 */
export function downloadSizeLabel(status: PrivateAiStatus): string | null {
  const total = status.totalSizeBytes
  const pending = pendingBytes(status)
  if (total <= 0) return null

  switch (status.state) {
    case 'not_installed':
      return pending < total
        ? `About ${approximateMegabytes(pending)} left to download (${approximateMegabytes(total)} in total)`
        : `One-time download · about ${approximateMegabytes(total)}`
    case 'paused':
      return `About ${approximateMegabytes(pending)} left to download`
    case 'repair_required':
    case 'failed':
      return pending > 0
        ? `Repair downloads about ${approximateMegabytes(pending)}`
        : 'Repair re-checks the installed files; nothing needs downloading'
    default:
      return null
  }
}

export type SetupStep =
  | { kind: 'determinate'; label: string; percent: number; bytesDownloaded: number; totalBytes: number }
  | { kind: 'indeterminate'; label: string }

/** Names the current setup step; bytes and percent cover only files being downloaded. */
export function describeSetupStep(
  progress: PrivateAiProgress | null,
  state: PrivateAiStatus['state'],
  subject = 'Private AI',
): SetupStep {
  if (progress?.phase === 'checking') return { kind: 'indeterminate', label: 'Checking installed files…' }
  if (progress?.phase === 'extracting') return { kind: 'indeterminate', label: 'Preparing the AI engine…' }
  if (progress?.phase === 'verifying' || state === 'verifying') return { kind: 'indeterminate', label: 'Verifying download…' }
  if (!progress || progress.totalSizeBytes <= 0) return { kind: 'indeterminate', label: 'Starting download…' }

  return {
    kind: 'determinate',
    label: progress.fileCount > 1
      ? `Downloading part ${progress.fileIndex} of ${progress.fileCount}`
      : `Downloading ${subject}`,
    percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
    bytesDownloaded: progress.bytesDownloaded,
    totalBytes: progress.totalSizeBytes,
  }
}
