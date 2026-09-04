import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OfflineAiDownloader } from './OfflineAiDownloader'
import type {
  InstalledAiPaths,
  OfflineAiDownloadResult,
  OfflineAiManifest,
  OfflineAiManifestFile,
  PrivateAiProgress,
  PrivateAiState,
  PrivateAiStatus,
} from './privateAiModels'

export interface OfflineAiDownloaderPort {
  downloadAll(
    manifest: OfflineAiManifest,
    rootPath: string,
    onProgress?: (progress: PrivateAiProgress) => void,
  ): Promise<OfflineAiDownloadResult>
  pause(): void
}

interface OfflineAiAssetServiceDependencies {
  userDataPath: string
  manifestPath: string
  downloader?: OfflineAiDownloaderPort
}

interface InstalledVersionMarker {
  version: string
}

function phaseForState(state: PrivateAiState): PrivateAiStatus['phase'] {
  switch (state) {
    case 'downloading': return 'downloading'
    case 'paused': return 'paused'
    case 'verifying': return 'verifying'
    case 'ready': return 'ready'
    case 'failed': return 'failed'
    default: return 'idle'
  }
}

function statusFor(state: PrivateAiState, totalBytes: number, message: string | null = null): PrivateAiStatus {
  return {
    state,
    phase: phaseForState(state),
    percent: state === 'ready' ? 100 : 0,
    fileIndex: 0,
    fileCount: 0,
    fileName: null,
    bytesDownloaded: state === 'ready' ? totalBytes : 0,
    totalBytes,
    fileBytesDownloaded: 0,
    fileSizeBytes: 0,
    message,
  }
}

export class OfflineAiAssetService {
  private readonly rootPath: string
  private readonly markerPath: string
  private readonly downloader: OfflineAiDownloaderPort
  private transientStatus: PrivateAiStatus | null = null

  constructor(private readonly dependencies: OfflineAiAssetServiceDependencies) {
    this.rootPath = join(dependencies.userDataPath, 'offline-ai')
    this.markerPath = join(this.rootPath, 'installed-version.json')
    this.downloader = dependencies.downloader ?? new OfflineAiDownloader()
  }

  async getVersion(): Promise<string> {
    return (await this.readManifest()).version
  }

  async getStatus(): Promise<PrivateAiStatus> {
    const manifest = await this.readManifest()
    const totalBytes = this.totalBytes(manifest)
    if (this.transientStatus && ['downloading', 'paused', 'verifying', 'failed'].includes(this.transientStatus.state)) {
      return { ...this.transientStatus, totalBytes }
    }

    const marker = await this.readMarker()
    if (!marker) return statusFor('not_installed', totalBytes)
    if (marker.version !== manifest.version) return statusFor('repair_required', totalBytes, 'Private AI needs repair')

    const paths = await this.verifyRequiredAssets(manifest)
    return paths
      ? statusFor('ready', totalBytes, 'Private AI is ready')
      : statusFor('repair_required', totalBytes, 'Private AI needs repair')
  }

  async getInstalledPaths(): Promise<InstalledAiPaths | null> {
    const manifest = await this.readManifest()
    const marker = await this.readMarker()
    if (!marker || marker.version !== manifest.version) return null
    return this.verifyRequiredAssets(manifest)
  }

  async startSetup(onProgress?: (progress: PrivateAiProgress) => void): Promise<PrivateAiStatus> {
    const manifest = await this.readManifest()
    const totalBytes = this.totalBytes(manifest)
    const current = await this.getStatus()
    if (current.state === 'ready') return current

    await mkdir(this.rootPath, { recursive: true })
    this.transientStatus = statusFor('downloading', totalBytes, 'Downloading Private AI')

    try {
      const result = await this.downloader.downloadAll(manifest, this.rootPath, (progress) => {
        this.transientStatus = { ...progress, totalBytes }
        onProgress?.(this.transientStatus)
      })

      if (result.paused) {
        const latest = this.transientStatus ?? statusFor('paused', totalBytes)
        this.transientStatus = { ...latest, state: 'paused', phase: 'paused', message: 'Private AI setup paused' }
        onProgress?.(this.transientStatus)
        return this.transientStatus
      }

      const latest = this.transientStatus ?? statusFor('verifying', totalBytes)
      this.transientStatus = { ...latest, state: 'verifying', phase: 'verifying', message: 'Verifying Private AI' }
      onProgress?.(this.transientStatus)

      const installedPaths = await this.verifyRequiredAssets(manifest)
      if (!installedPaths) {
        this.transientStatus = null
        return statusFor('repair_required', totalBytes, 'Private AI needs repair')
      }

      await this.writeMarkerAtomically(manifest.version)
      this.transientStatus = null
      const ready = statusFor('ready', totalBytes, 'Private AI is ready')
      onProgress?.(ready)
      return ready
    } catch {
      this.transientStatus = statusFor('failed', totalBytes, 'Private AI setup failed')
      onProgress?.(this.transientStatus)
      return this.transientStatus
    }
  }

  pauseSetup(): PrivateAiStatus | null {
    this.downloader.pause()
    if (!this.transientStatus || !['downloading', 'verifying'].includes(this.transientStatus.state)) return this.transientStatus
    this.transientStatus = {
      ...this.transientStatus,
      state: 'paused',
      phase: 'paused',
      message: 'Private AI setup paused',
    }
    return this.transientStatus
  }

  async repair(onProgress?: (progress: PrivateAiProgress) => void): Promise<PrivateAiStatus> {
    await rm(this.markerPath, { force: true })
    this.transientStatus = null
    return this.startSetup(onProgress)
  }

  private async readManifest(): Promise<OfflineAiManifest> {
    const raw = await readFile(this.dependencies.manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as OfflineAiManifest
    if (!parsed || typeof parsed.version !== 'string' || !Array.isArray(parsed.files)) {
      throw new Error('Invalid offline AI manifest')
    }
    return parsed
  }

  private totalBytes(manifest: OfflineAiManifest): number {
    return manifest.files.filter((file) => file.required).reduce((sum, file) => sum + file.sizeBytes, 0)
  }

  private async readMarker(): Promise<InstalledVersionMarker | null> {
    try {
      const parsed = JSON.parse(await readFile(this.markerPath, 'utf8')) as InstalledVersionMarker
      return typeof parsed?.version === 'string' ? parsed : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
      throw error
    }
  }

  private async verifyRequiredAssets(manifest: OfflineAiManifest): Promise<InstalledAiPaths | null> {
    const runtime = this.requiredByType(manifest, 'runtime')
    const granite = this.requiredByType(manifest, 'model')
    const nomic = this.requiredByType(manifest, 'embedding')
    if (!runtime || !granite || !nomic) return null

    const llamaDir = join(this.rootPath, runtime.targetPath)
    const serverExe = join(llamaDir, 'llama-server.exe')
    if (!(await this.fileExists(serverExe))) return null

    const graniteModel = join(this.rootPath, granite.targetPath)
    const nomicModel = join(this.rootPath, nomic.targetPath)
    if (!(await this.verifyModelFile(graniteModel, granite))) return null
    if (!(await this.verifyModelFile(nomicModel, nomic))) return null

    return { llamaDir, serverExe, graniteModel, nomicModel }
  }

  private requiredByType(manifest: OfflineAiManifest, type: OfflineAiManifestFile['type']): OfflineAiManifestFile | null {
    return manifest.files.find((file) => file.required && file.type === type) ?? null
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      const info = await stat(path)
      return info.isFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private async verifyModelFile(path: string, file: OfflineAiManifestFile): Promise<boolean> {
    try {
      const info = await stat(path)
      if (!info.isFile() || info.size !== file.sizeBytes) return false
      return (await this.sha256(path)) === file.sha256.toUpperCase()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private async sha256(path: string): Promise<string> {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return hash.digest('hex').toUpperCase()
  }

  private async writeMarkerAtomically(version: string): Promise<void> {
    const tempPath = `${this.markerPath}.tmp-${process.pid}-${Date.now()}`
    await mkdir(this.rootPath, { recursive: true })
    await writeFile(tempPath, JSON.stringify({ version }), 'utf8')
    await rm(this.markerPath, { force: true })
    await rename(tempPath, this.markerPath)
  }
}
