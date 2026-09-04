import type { PrivateAiPublicProgress, PrivateAiPublicStatus } from '../../shared/desktopApi'
import type { IpcHandleRegistrar } from '../auth/authIpc'
import type { PrivateAiProgress, PrivateAiState, PrivateAiStatus } from './privateAiModels'

export interface PrivateAiIpcService {
  getStatus(): Promise<PrivateAiStatus>
  getVersion(): Promise<string>
  startSetup(onProgress?: (progress: PrivateAiProgress) => void): Promise<PrivateAiStatus>
  pauseSetup(): PrivateAiStatus | null
  repair(onProgress?: (progress: PrivateAiProgress) => void): Promise<PrivateAiStatus>
}

interface PrivateAiIpcEvent {
  sender?: {
    send(channel: string, payload: unknown): void
  }
}

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

function safeStatus(status: PrivateAiStatus, version: string): PrivateAiPublicStatus {
  const state = safeState(status.state)
  return {
    state,
    ready: state === 'ready',
    repairRequired: state === 'repair_required',
    totalSizeBytes: Number(status.totalBytes) || 0,
    version,
    message: status.message == null ? null : String(status.message),
  }
}

function safeProgress(progress: PrivateAiProgress): PrivateAiPublicProgress {
  const fileIndex = Number(progress.fileIndex) || 0
  const fileCount = Number(progress.fileCount) || 0
  return {
    state: safeState(progress.state),
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
  const publicStatus = async (status: PrivateAiStatus) => safeStatus(status, await service.getVersion())
  const maybeReady = (status: PrivateAiStatus) => {
    if (status.state === 'ready') onReady?.()
  }
  const progressFor = (event: unknown) => {
    const sender = (event as PrivateAiIpcEvent | null)?.sender
    return (progress: PrivateAiProgress) => sender?.send('private-ai:progress', safeProgress(progress))
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
}
