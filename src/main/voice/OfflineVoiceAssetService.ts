import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OfflineAiDownloader } from '../ai/OfflineAiDownloader'
import type { OfflineAiDownloadResult, OfflineAiManifest, PrivateAiProgress } from '../ai/privateAiModels'
import {
  PINNED_VOICE_MODEL,
  PINNED_VOICE_RUNTIME,
  parseVoiceManifest,
  type InstalledVoicePaths,
  type VoiceProgress,
  type VoiceStatus,
} from './voiceModels'

interface VoiceDownloaderPort {
  downloadAll(
    manifest: OfflineAiManifest,
    rootPath: string,
    onProgress?: (progress: PrivateAiProgress) => void,
  ): Promise<OfflineAiDownloadResult>
  pause(): void
}

interface OfflineVoiceAssetServiceDependencies {
  userDataPath: string
  manifestPath: string
  downloader?: VoiceDownloaderPort
  verifyInstalled?: (manifest: OfflineAiManifest, rootPath: string) => Promise<InstalledVoicePaths | null>
}

function statusFor(
  state: VoiceStatus['state'],
  totalBytes: number,
  message: string | null = null,
): VoiceStatus {
  const phase: VoiceStatus['phase'] = state === 'downloading'
    ? 'downloading'
    : state === 'paused'
      ? 'paused'
      : state === 'verifying'
        ? 'verifying'
        : state === 'ready'
          ? 'ready'
          : state === 'failed'
            ? 'failed'
            : 'idle'
  return {
    state,
    phase,
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

function safeProgress(progress: PrivateAiProgress, totalBytes: number): VoiceProgress {
  const message = progress.phase === 'extracting'
    ? 'Preparing offline voice'
    : progress.state === 'paused'
      ? 'Offline voice setup paused'
      : progress.state === 'verifying'
        ? 'Verifying offline voice'
        : 'Downloading offline voice'
  return { ...progress, totalBytes, message }
}

export class OfflineVoiceAssetService {
  private readonly rootPath: string
  private readonly markerPath: string
  private readonly downloader: VoiceDownloaderPort
  private readonly verifyInstalledOverride?: OfflineVoiceAssetServiceDependencies['verifyInstalled']
  private transientStatus: VoiceStatus | null = null

  constructor(private readonly dependencies: OfflineVoiceAssetServiceDependencies) {
    this.rootPath = join(dependencies.userDataPath, 'offline-voice')
    this.markerPath = join(this.rootPath, 'installed-version.json')
    this.downloader = dependencies.downloader ?? new OfflineAiDownloader()
    this.verifyInstalledOverride = dependencies.verifyInstalled
  }

  async getStatus(): Promise<VoiceStatus> {
    const manifest = await this.readManifest()
    const totalBytes = this.totalBytes(manifest)
    if (this.transientStatus && ['downloading','paused','verifying','failed'].includes(this.transientStatus.state)) {
      return { ...this.transientStatus, totalBytes }
    }

    const marker = await this.readMarker()
    if (!marker) return statusFor('not_installed', totalBytes)
    if (marker.version !== manifest.version) return statusFor('repair_required', totalBytes, 'Offline voice needs repair')
    return await this.verifyInstalled(manifest)
      ? statusFor('ready', totalBytes, 'Offline voice is ready')
      : statusFor('repair_required', totalBytes, 'Offline voice needs repair')
  }

  async getInstalledPaths(): Promise<InstalledVoicePaths | null> {
    const manifest = await this.readManifest()
    const marker = await this.readMarker()
    if (!marker || marker.version !== manifest.version) return null
    return this.verifyInstalled(manifest)
  }

  async startSetup(onProgress?: (progress: VoiceProgress) => void): Promise<VoiceStatus> {
    const manifest = await this.readManifest()
    const totalBytes = this.totalBytes(manifest)
    const current = await this.getStatus()
    if (current.state === 'ready') return current

    await mkdir(this.rootPath, { recursive: true })
    this.transientStatus = statusFor('downloading', totalBytes, 'Downloading offline voice')
    try {
      const result = await this.downloader.downloadAll(manifest, this.rootPath, (progress) => {
        this.transientStatus = safeProgress(progress, totalBytes)
        onProgress?.(this.transientStatus)
      })
      if (result.paused) {
        const latest = this.transientStatus ?? statusFor('paused', totalBytes)
        this.transientStatus = { ...latest, state: 'paused', phase: 'paused', message: 'Offline voice setup paused' }
        onProgress?.(this.transientStatus)
        return this.transientStatus
      }

      const latest = this.transientStatus ?? statusFor('verifying', totalBytes)
      this.transientStatus = { ...latest, state: 'verifying', phase: 'verifying', message: 'Verifying offline voice' }
      onProgress?.(this.transientStatus)
      if (!(await this.verifyInstalled(manifest))) {
        this.transientStatus = null
        return statusFor('repair_required', totalBytes, 'Offline voice needs repair')
      }

      await this.writeMarkerAtomically(manifest.version)
      this.transientStatus = null
      const ready = statusFor('ready', totalBytes, 'Offline voice is ready')
      onProgress?.(ready)
      return ready
    } catch {
      this.transientStatus = statusFor('failed', totalBytes, 'Offline voice setup failed')
      onProgress?.(this.transientStatus)
      return this.transientStatus
    }
  }

  pauseSetup(): VoiceStatus | null {
    this.downloader.pause()
    if (!this.transientStatus || !['downloading','verifying'].includes(this.transientStatus.state)) return this.transientStatus
    this.transientStatus = {
      ...this.transientStatus,
      state: 'paused',
      phase: 'paused',
      message: 'Offline voice setup paused',
    }
    return this.transientStatus
  }

  async repair(onProgress?: (progress: VoiceProgress) => void): Promise<VoiceStatus> {
    await rm(this.markerPath, { force: true })
    this.transientStatus = null
    return this.startSetup(onProgress)
  }

  private async readManifest(): Promise<OfflineAiManifest> {
    return parseVoiceManifest(await readFile(this.dependencies.manifestPath, 'utf8'))
  }

  private totalBytes(manifest: OfflineAiManifest): number {
    return manifest.files.filter((file) => file.required).reduce((sum, file) => sum + file.sizeBytes, 0)
  }

  private async readMarker(): Promise<{ version: string } | null> {
    try {
      const parsed = JSON.parse(await readFile(this.markerPath, 'utf8')) as { version?: unknown }
      return typeof parsed.version === 'string' ? { version: parsed.version } : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
      throw error
    }
  }

  private async verifyInstalled(manifest: OfflineAiManifest): Promise<InstalledVoicePaths | null> {
    if (this.verifyInstalledOverride) return this.verifyInstalledOverride(manifest, this.rootPath)
    const runtimeDir = join(this.rootPath, PINNED_VOICE_RUNTIME.targetPath)
    const executable = join(runtimeDir, 'Release', 'whisper-cli.exe')
    const model = join(this.rootPath, PINNED_VOICE_MODEL.targetPath)
    if (!(await this.fileExists(executable))) return null
    if (!(await this.verifyFile(model, PINNED_VOICE_MODEL.sizeBytes, PINNED_VOICE_MODEL.sha256))) return null
    return { runtimeDir, executable, model }
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private async verifyFile(path: string, sizeBytes: number, expectedSha: string): Promise<boolean> {
    try {
      const info = await stat(path)
      if (!info.isFile() || info.size !== sizeBytes) return false
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path)) hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      return hash.digest('hex').toLowerCase() === expectedSha.toLowerCase()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private async writeMarkerAtomically(version: string): Promise<void> {
    const temporary = `${this.markerPath}.tmp-${process.pid}-${Date.now()}`
    await mkdir(this.rootPath, { recursive: true })
    await writeFile(temporary, JSON.stringify({ version }), 'utf8')
    await rm(this.markerPath, { force: true })
    await rename(temporary, this.markerPath)
  }
}
