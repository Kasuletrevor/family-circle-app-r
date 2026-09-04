export type PrivateAiState =
  | 'not_installed'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'ready'
  | 'repair_required'
  | 'failed'

export interface PrivateAiStatus {
  state: PrivateAiState
  ready: boolean
  repairRequired: boolean
  totalSizeBytes: number
  version: string
  message: string | null
}

export interface PrivateAiProgress {
  state: PrivateAiState
  percent: number
  fileIndex: number
  fileCount: number
  fileName: string | null
  bytesDownloaded: number
  totalSizeBytes: number
  fileBytesDownloaded: number
  fileSizeBytes: number
  message: string | null
}

export interface PrivateAiClient {
  getStatus(): Promise<PrivateAiStatus>
  startSetup(): Promise<PrivateAiStatus>
  pauseSetup(): Promise<PrivateAiStatus>
  repair(): Promise<PrivateAiStatus>
  onProgress(listener: (progress: PrivateAiProgress) => void): () => void
}
