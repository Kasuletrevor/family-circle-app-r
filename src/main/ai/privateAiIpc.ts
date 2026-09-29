import type { PrivateAiPublicProgress, PrivateAiPublicStatus } from '../../shared/desktopApi'
import type { IpcHandleRegistrar } from '../auth/authIpc'
import type { PrivateAiPhase, PrivateAiProgress, PrivateAiSetupStatus, PrivateAiState } from './privateAiModels'

export interface PrivateAiIpcService {
  getStatus(): Promise<PrivateAiSetupStatus>
  getVersion(): Promise<string>
  startSetup(onProgress?: (progress: PrivateAiProgress) => void): Promise<PrivateAiSetupStatus>
  pauseSetup(): PrivateAiSetupStatus | null
  repair(onProgress?: (progress: PrivateAiProgress) => void): Promise<PrivateAiSetupStatus>
  remove(): Promise<PrivateAiSetupStatus>
}

interface PrivateAiIpcEvent {
  sender?: {
    send(channel: string, payload: unknown): void
  }
}

const DOWNLOAD_PROGRESS_MIN_INTERVAL_MS = 100

function safeState(value: unknown): PrivateAiState {
  return value === 'not_installed'
    || value === 'downloading'
    || value === 'paused'
    || value === 'verifying'
    || value === 'ready'
    || value === 'repair_required'
    || value === 'failed'
    ? value
    : 'failed'
}

function safeStatus(status: PrivateAiSetupStatus, version: string): PrivateAiPublicStatus {
  const state = safeState(status.state)
  return {
    state,
    ready: state === 'ready',
    repairRequired: state === 'repair_required',
    totalSizeBytes: Number(status.installSizeBytes) || 0,
    downloadSizeBytes: Number(status.pendingDownloadBytes) || 0,
    version,
    message: status.message == null ? null : String(status.message),
  }
}

function safePhase(value: PrivateAiPhase | undefined): PrivateAiPublicProgress['phase'] {
  return value === 'checking' || value === 'downloading' || value === 'verifying' || value === 'extracting'
    ? value
    : null
}

function safeProgress(progress: PrivateAiProgress): PrivateAiPublicProgress {
  const fileIndex = Number(progress.fileIndex) || 0
  const fileCount = Number(progress.fileCount) || 0
  return {
    state: safeState(progress.state),
    phase: safePhase(progress.phase),
    percent: Number(progress.percent) || 0,
    fileIndex,
    fileCount,
    fileName: fileIndex > 0 && fileCount > 0
      ? `Private AI component ${fileIndex} of ${fileCount}`
      : null,
    bytesDownloaded: Number(progress.bytesDownloaded) || 0,
    totalSizeBytes: Number(progress.totalBytes) || 0,
    fileBytesDownloaded: Number(progress.fileBytesDownloaded) || 0,
    fileSizeBytes: Number(progress.fileSizeBytes) || 0,
    message: progress.message == null ? null : String(progress.message),
  }
}

export function registerPrivateAiIpc(
  ipc: IpcHandleRegistrar,
  service: PrivateAiIpcService,
  onReady?: () => void,
): void {
  const publicStatus = async (status: PrivateAiSetupStatus) => safeStatus(status, await service.getVersion())
  const maybeReady = (status: PrivateAiSetupStatus) => {
    if (status.state === 'ready') onReady?.()
  }
  const progressFor = (event: unknown) => {
    const sender = (event as PrivateAiIpcEvent | null)?.sender
    let lastState: PrivateAiState | null = null
    let lastDownloadingSentAt = Number.NEGATIVE_INFINITY

    return (progress: PrivateAiProgress) => {
      const state = safeState(progress.state)
      const now = Date.now()
      const stateChanged = state !== lastState
      if (
        state === 'downloading'
        && !stateChanged
        && now - lastDownloadingSentAt < DOWNLOAD_PROGRESS_MIN_INTERVAL_MS
      ) {
        return
      }

      sender?.send('private-ai:progress', safeProgress(progress))
      lastState = state
      if (state === 'downloading') lastDownloadingSentAt = now
    }
  }

  ipc.handle('private-ai:get-status', async () => publicStatus(await service.getStatus()))
  ipc.handle('private-ai:start-setup', async (event) => {
    const status = await service.startSetup(progressFor(event))
    maybeReady(status)
    return publicStatus(status)
  })
  ipc.handle('private-ai:pause-setup', async () => {
    const status = service.pauseSetup() ?? await service.getStatus()
    return publicStatus(status)
  })
  ipc.handle('private-ai:repair', async (event) => {
    const status = await service.repair(progressFor(event))
    maybeReady(status)
    return publicStatus(status)
  })
  ipc.handle('private-ai:remove', async (event) => {
    const status = await service.remove()
    const publicResult = await publicStatus(status)
    const sender = (event as PrivateAiIpcEvent | null)?.sender
    sender?.send('private-ai:progress', safeProgress(status))
    return publicResult
  })
}
