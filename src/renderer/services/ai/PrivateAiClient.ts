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
  /** Bytes still to download for setup or repair; absent from older/voice statuses. */
  downloadSizeBytes?: number
  version: string
  message: string | null
}

export type PrivateAiPhase = 'checking' | 'downloading' | 'verifying' | 'extracting'

export interface PrivateAiProgress {
  state: PrivateAiState
  /** Current step; bytes and percent cover only the files still being downloaded. */
  phase?: PrivateAiPhase | null
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
  remove(): Promise<PrivateAiStatus>
  onProgress(listener: (progress: PrivateAiProgress) => void): () => void
}
