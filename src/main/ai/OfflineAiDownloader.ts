import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import type {
  OfflineAiDownloadResult,
  OfflineAiManifest,
  OfflineAiManifestFile,
  PrivateAiProgress,
} from './privateAiModels'

export interface OfflineAiDownloadFs {
  stat(path: string): Promise<{ size: number } | null>
  mkdir(path: string): Promise<void>
  truncate(path: string): Promise<void>
  append(path: string, chunk: Uint8Array): Promise<void>
  readChunks(path: string): AsyncIterable<Uint8Array>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
}

export interface OfflineAiHttpResponse {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: AsyncIterable<Uint8Array>
}

export interface OfflineAiHttpPort {
  request(url: string, options: { headers: Record<string, string> }): Promise<OfflineAiHttpResponse>
}

export interface OfflineAiArchivePort {
  extractZip(zipPath: string, destinationPath: string): Promise<void>
}

type OfflineAiDownloadErrorCode = 'http-error' | 'size-mismatch' | 'sha-mismatch' | 'extract-failed'

export class OfflineAiDownloadError extends Error {
  constructor(public readonly code: OfflineAiDownloadErrorCode, message: string) {
    super(message)
    this.name = 'OfflineAiDownloadError'
  }
}

class NodeDownloadFs implements OfflineAiDownloadFs {
  async stat(path: string): Promise<{ size: number } | null> {
    try {
      const info = await stat(path)
      return { size: info.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
  }

  async truncate(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.alloc(0))
  }

  async append(path: string, chunk: Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, chunk)
  }

  async *readChunks(path: string): AsyncIterable<Uint8Array> {
    for await (const chunk of createReadStream(path)) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    }
  }

  async rename(from: string, to: string): Promise<void> {
    await mkdir(dirname(to), { recursive: true })
    await rename(from, to)
  }

  async remove(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true })
  }
}

class NodeHttpPort implements OfflineAiHttpPort {
  async request(url: string, options: { headers: Record<string, string> }): Promise<OfflineAiHttpResponse> {
    return this.requestFollowingRedirects(url, options, 0)
  }

  private async requestFollowingRedirects(
    url: string,
    options: { headers: Record<string, string> },
    redirectCount: number,
  ): Promise<OfflineAiHttpResponse> {
    if (redirectCount > 5) throw new OfflineAiDownloadError('http-error', 'Too many redirects while downloading Private AI assets')

    return new Promise((resolveResponse, reject) => {
      const request = url.startsWith('https:') ? httpsRequest : httpRequest
      const req = request(url, { method: 'GET', headers: options.headers }, (response) => {
        const statusCode = response.statusCode ?? 0
        const location = response.headers.location
        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume()
          const nextUrl = new URL(location, url).toString()
          void this.requestFollowingRedirects(nextUrl, options, redirectCount + 1).then(resolveResponse, reject)
          return
        }

        resolveResponse({
          statusCode,
          headers: response.headers as Record<string, string | string[] | undefined>,
          body: response,
        })
      })
      req.on('error', reject)
      req.end()
    })
  }
}

class PowerShellArchivePort implements OfflineAiArchivePort {
  async extractZip(zipPath: string, destinationPath: string): Promise<void> {
    await mkdir(dirname(destinationPath), { recursive: true })
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
          zipPath,
          destinationPath,
        ],
        { windowsHide: true },
      )
      child.once('error', reject)
      child.once('exit', (code) => {
        if (code === 0) resolvePromise()
        else reject(new OfflineAiDownloadError('extract-failed', 'Private AI runtime extraction failed'))
      })
    })
  }
}

interface OfflineAiDownloaderDependencies {
  fs?: OfflineAiDownloadFs
  http?: OfflineAiHttpPort
  archive?: OfflineAiArchivePort
}

function safeTarget(rootPath: string, relativeTarget: string): string {
  if (isAbsolute(relativeTarget)) throw new Error('Offline AI manifest target must be relative')
  const root = resolve(rootPath)
  const candidate = resolve(root, relativeTarget)
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error('Offline AI manifest target escapes its root')
  }
  return candidate
}

function stagingPartPath(rootPath: string, manifest: OfflineAiManifest, file: OfflineAiManifestFile): string {
  const suffix = file.extract ? '.zip.part' : '.part'
  return safeTarget(join(rootPath, '.staging', manifest.version), `${file.targetPath}${suffix}`)
}

function percent(downloaded: number, total: number): number {
  if (total <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)))
}

export class OfflineAiDownloader {
  private readonly fs: OfflineAiDownloadFs
  private readonly http: OfflineAiHttpPort
  private readonly archive: OfflineAiArchivePort
  private pauseRequested = false

  constructor(dependencies: OfflineAiDownloaderDependencies = {}) {
    this.fs = dependencies.fs ?? new NodeDownloadFs()
    this.http = dependencies.http ?? new NodeHttpPort()
    this.archive = dependencies.archive ?? new PowerShellArchivePort()
  }

  pause(): void {
    this.pauseRequested = true
  }

  async downloadAll(
    manifest: OfflineAiManifest,
    rootPath: string,
    onProgress?: (progress: PrivateAiProgress) => void,
  ): Promise<OfflineAiDownloadResult> {
    this.pauseRequested = false
    const requiredFiles = manifest.files.filter((file) => file.required)
    const totalBytes = requiredFiles.reduce((sum, file) => sum + file.sizeBytes, 0)
    let completedBytes = 0

    for (let index = 0; index < requiredFiles.length; index += 1) {
      const file = requiredFiles[index]!
      const finalPath = safeTarget(rootPath, file.targetPath)

      if (await this.isAlreadyInstalled(file, finalPath)) {
        completedBytes += file.sizeBytes
        continue
      }

      const partPath = stagingPartPath(rootPath, manifest, file)
      await this.fs.mkdir(dirname(partPath))
      let existingBytes = (await this.fs.stat(partPath))?.size ?? 0
      if (existingBytes > file.sizeBytes) {
        await this.fs.truncate(partPath)
        existingBytes = 0
      }

      if (existingBytes < file.sizeBytes) {
        const headers: Record<string, string> = {}
        if (existingBytes > 0) headers.Range = `bytes=${existingBytes}-`
        const response = await this.http.request(file.url, { headers })

        if (existingBytes > 0 && response.statusCode === 200) {
          await this.fs.truncate(partPath)
          existingBytes = 0
        } else if (response.statusCode !== 200 && response.statusCode !== 206) {
          throw new OfflineAiDownloadError('http-error', 'Private AI asset download failed')
        }

        if (existingBytes === 0 && response.statusCode === 200) {
          await this.fs.truncate(partPath)
        }

        let fileBytes = existingBytes
        for await (const chunk of response.body) {
          await this.fs.append(partPath, chunk)
          fileBytes += chunk.byteLength
          onProgress?.(this.progress({
            state: 'downloading',
            phase: 'downloading',
            manifest,
            file,
            fileIndex: index + 1,
            fileCount: requiredFiles.length,
            fileBytes,
            completedBytes,
            totalBytes,
            message: 'Downloading Private AI',
          }))

          if (this.pauseRequested) return { paused: true }
        }
      }

      const partInfo = await this.fs.stat(partPath)
      if (!partInfo || partInfo.size !== file.sizeBytes) {
        throw new OfflineAiDownloadError('size-mismatch', 'Private AI asset size verification failed')
      }

      onProgress?.(this.progress({
        state: 'verifying',
        phase: 'verifying',
        manifest,
        file,
        fileIndex: index + 1,
        fileCount: requiredFiles.length,
        fileBytes: file.sizeBytes,
        completedBytes,
        totalBytes,
        message: 'Verifying Private AI',
      }))

      const actualHash = await this.sha256(partPath)
      if (actualHash !== file.sha256.toUpperCase()) {
        throw new OfflineAiDownloadError('sha-mismatch', 'Private AI asset integrity verification failed')
      }

      if (file.extract) {
        onProgress?.(this.progress({
          state: 'verifying',
          phase: 'extracting',
          manifest,
          file,
          fileIndex: index + 1,
          fileCount: requiredFiles.length,
          fileBytes: file.sizeBytes,
          completedBytes,
          totalBytes,
          message: 'Preparing Private AI engine',
        }))
        await this.fs.remove(finalPath)
        await this.archive.extractZip(partPath, finalPath)
        await this.fs.remove(partPath)
      } else {
        await this.fs.remove(finalPath)
        await this.fs.rename(partPath, finalPath)
      }

      completedBytes += file.sizeBytes
    }

    return { paused: false }
  }

  private progress(input: {
    state: PrivateAiProgress['state']
    phase: PrivateAiProgress['phase']
    manifest: OfflineAiManifest
    file: OfflineAiManifestFile
    fileIndex: number
    fileCount: number
    fileBytes: number
    completedBytes: number
    totalBytes: number
    message: string
  }): PrivateAiProgress {
    const bytesDownloaded = Math.min(input.totalBytes, input.completedBytes + input.fileBytes)
    return {
      state: input.state,
      phase: input.phase,
      percent: percent(bytesDownloaded, input.totalBytes),
      fileIndex: input.fileIndex,
      fileCount: input.fileCount,
      fileName: input.file.name,
      bytesDownloaded,
      totalBytes: input.totalBytes,
      fileBytesDownloaded: input.fileBytes,
      fileSizeBytes: input.file.sizeBytes,
      message: input.message,
    }
  }

  private async isAlreadyInstalled(file: OfflineAiManifestFile, finalPath: string): Promise<boolean> {
    if (file.extract) {
      return (await this.fs.stat(join(finalPath, 'llama-server.exe'))) !== null
    }
    const info = await this.fs.stat(finalPath)
    if (!info || info.size !== file.sizeBytes) return false
    return (await this.sha256(finalPath)) === file.sha256.toUpperCase()
  }

  private async sha256(path: string): Promise<string> {
    const hash = createHash('sha256')
    for await (const chunk of this.fs.readChunks(path)) hash.update(Buffer.from(chunk))
    return hash.digest('hex').toUpperCase()
  }
}
