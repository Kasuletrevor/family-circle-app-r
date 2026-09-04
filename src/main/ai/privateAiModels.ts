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

export interface InstalledAiPaths {
  llamaDir: string
  serverExe: string
  graniteModel: string
  nomicModel: string
}

export interface OfflineAiDownloadResult {
  paused: boolean
}
