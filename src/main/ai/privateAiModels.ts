export type PrivateAiState =
  | 'not_installed'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'ready'
  | 'repair_required'
  | 'failed'

export type PrivateAiPhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'paused'
  | 'ready'
  | 'failed'

export type OfflineAiAssetType = 'runtime' | 'model' | 'embedding'

export interface OfflineAiManifestFile {
  name: string
  type: OfflineAiAssetType
  url: string
  targetPath: string
  sha256: string
  sizeBytes: number
  extract: boolean
  required: boolean
}

export interface OfflineAiManifest {
  version: string
  files: OfflineAiManifestFile[]
}

export interface PrivateAiProgress {
  state: PrivateAiState
  phase: PrivateAiPhase
  percent: number
  fileIndex: number
  fileCount: number
  fileName: string | null
  bytesDownloaded: number
  totalBytes: number
  fileBytesDownloaded: number
  fileSizeBytes: number
  message: string | null
}

export interface PrivateAiStatus extends PrivateAiProgress {}

/** Private AI setup status (the offline voice setup shares PrivateAiStatus without these). */
export interface PrivateAiSetupStatus extends PrivateAiStatus {
  /** Full size of all required assets. */
  installSizeBytes: number
  /** Bytes still to download for setup or repair (0 when ready). */
  pendingDownloadBytes: number
}

export interface InstalledAiPaths {
  llamaDir: string
  serverExe: string
  generationModel: string
  nomicModel: string
}

export interface OfflineAiDownloadResult {
  paused: boolean
}
