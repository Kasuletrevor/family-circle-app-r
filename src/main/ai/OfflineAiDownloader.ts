import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open as openFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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

export interface OfflineAiWriteSession {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
}

export interface OfflineAiDownloadFs {
  stat(path: string): Promise<{ size: number } | null>
  mkdir(path: string): Promise<void>
  truncate(path: string): Promise<void>
  openWriter(path: string, mode: 'append' | 'truncate'): Promise<OfflineAiWriteSession>
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

  async openWriter(path: string, mode: 'append' | 'truncate'): Promise<OfflineAiWriteSession> {
    await mkdir(dirname(path), { recursive: true })
    const handle = await openFile(path, mode === 'append' ? 'a' : 'w')
    let closed = false
    return {
      write: async (chunk) => {
        if (closed) throw new Error('Offline AI writer is closed')
        await handle.write(Buffer.from(chunk))
      },
      close: async () => {
        if (closed) return
        closed = true
        await handle.close()
      },
    }
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
  parallelDownloadThresholdBytes?: number
  maxParallelParts?: number
}

interface ByteRange {
  start: number
  end: number
}

const DEFAULT_PARALLEL_DOWNLOAD_THRESHOLD_BYTES = 128 * 1024 * 1024
const DEFAULT_MAX_PARALLEL_PARTS = 4

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

function headerValue(headers: OfflineAiHttpResponse['headers'], name: string): string | null {
  const value = headers[name.toLowerCase()] ?? headers[name]
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function planByteRanges(sizeBytes: number, partCount: number): ByteRange[] {
  const count = Math.max(1, Math.min(partCount, sizeBytes))
  const partSize = Math.ceil(sizeBytes / count)
  const ranges: ByteRange[] = []
  for (let start = 0; start < sizeBytes; start += partSize) {
    ranges.push({ start, end: Math.min(sizeBytes - 1, start + partSize - 1) })
  }
  return ranges
}

function contentRangeMatches(response: OfflineAiHttpResponse, range: ByteRange, totalSize: number): boolean {
  const value = headerValue(response.headers, 'content-range')
  if (!value) return false
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(value.trim())
  if (!match) return false
  return Number(match[1]) === range.start
    && Number(match[2]) === range.end
    && Number(match[3]) === totalSize
}

export class OfflineAiDownloader {
  private readonly fs: OfflineAiDownloadFs
  private readonly http: OfflineAiHttpPort
  private readonly archive: OfflineAiArchivePort
  private readonly parallelDownloadThresholdBytes: number
  private readonly maxParallelParts: number
  private pauseRequested = false

  constructor(dependencies: OfflineAiDownloaderDependencies = {}) {
    this.fs = dependencies.fs ?? new NodeDownloadFs()
    this.http = dependencies.http ?? new NodeHttpPort()
    this.archive = dependencies.archive ?? new PowerShellArchivePort()
    this.parallelDownloadThresholdBytes = dependencies.parallelDownloadThresholdBytes ?? DEFAULT_PARALLEL_DOWNLOAD_THRESHOLD_BYTES
    this.maxParallelParts = Math.max(2, Math.min(4, dependencies.maxParallelParts ?? DEFAULT_MAX_PARALLEL_PARTS))
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
        const progressContext = {
          manifest,
          file,
          fileIndex: index + 1,
          fileCount: requiredFiles.length,
          completedBytes,
          totalBytes,
          onProgress,
        }
        const paused = existingBytes === 0 && this.shouldParallelize(file)
          ? await this.downloadParallel(partPath, progressContext)
          : await this.downloadSequential(partPath, existingBytes, progressContext)
        if (paused) return { paused: true }
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

  private shouldParallelize(file: OfflineAiManifestFile): boolean {
    return file.type === 'model'
      && !file.extract
      && file.sizeBytes >= this.parallelDownloadThresholdBytes
  }

  private async downloadSequential(
    partPath: string,
    initialBytes: number,
    context: {
      manifest: OfflineAiManifest
      file: OfflineAiManifestFile
      fileIndex: number
      fileCount: number
      completedBytes: number
      totalBytes: number
      onProgress?: (progress: PrivateAiProgress) => void
    },
    suppliedResponse?: OfflineAiHttpResponse,
  ): Promise<boolean> {
    let existingBytes = initialBytes
    const headers: Record<string, string> = {}
    if (existingBytes > 0) headers.Range = `bytes=${existingBytes}-`
    const response = suppliedResponse ?? await this.http.request(context.file.url, { headers })

    if (existingBytes > 0 && response.statusCode === 200) {
      await this.fs.truncate(partPath)
      existingBytes = 0
    } else if (response.statusCode !== 200 && response.statusCode !== 206) {
      throw new OfflineAiDownloadError('http-error', 'Private AI asset download failed')
    }

    if (existingBytes === 0 && response.statusCode === 200) {
      await this.fs.truncate(partPath)
    }

    const writer = await this.fs.openWriter(partPath, 'append')
    let fileBytes = existingBytes
    try {
      for await (const chunk of response.body) {
        await writer.write(chunk)
        fileBytes += chunk.byteLength
        context.onProgress?.(this.progress({
          state: 'downloading',
          phase: 'downloading',
          manifest: context.manifest,
          file: context.file,
          fileIndex: context.fileIndex,
          fileCount: context.fileCount,
          fileBytes,
          completedBytes: context.completedBytes,
          totalBytes: context.totalBytes,
          message: 'Downloading Private AI',
        }))
        if (this.pauseRequested) return true
      }
    } finally {
      await writer.close()
    }
    return false
  }

  private async downloadParallel(
    partPath: string,
    context: {
      manifest: OfflineAiManifest
      file: OfflineAiManifestFile
      fileIndex: number
      fileCount: number
      completedBytes: number
      totalBytes: number
      onProgress?: (progress: PrivateAiProgress) => void
    },
  ): Promise<boolean> {
    const ranges = planByteRanges(context.file.sizeBytes, this.maxParallelParts)
    if (ranges.length < 2) return this.downloadSequential(partPath, 0, context)

    const segmentPaths = ranges.map((_, index) => `${partPath}.range-${index}`)
    await Promise.all(segmentPaths.map((path) => this.fs.remove(path)))

    const firstRange = ranges[0]!
    const firstResponse = await this.http.request(context.file.url, {
      headers: { Range: `bytes=${firstRange.start}-${firstRange.end}` },
    })

    if (firstResponse.statusCode === 200) {
      return this.downloadSequential(partPath, 0, context, firstResponse)
    }
    if (firstResponse.statusCode !== 206 || !contentRangeMatches(firstResponse, firstRange, context.file.sizeBytes)) {
      throw new OfflineAiDownloadError('http-error', 'Private AI server returned an invalid byte range')
    }

    const validator = headerValue(firstResponse.headers, 'etag') ?? headerValue(firstResponse.headers, 'last-modified')
    const responses: OfflineAiHttpResponse[] = [firstResponse]
    const remainingResponses = await Promise.all(ranges.slice(1).map(async (range) => {
      const headers: Record<string, string> = { Range: `bytes=${range.start}-${range.end}` }
      if (validator) headers['If-Range'] = validator
      const response = await this.http.request(context.file.url, { headers })
      if (response.statusCode !== 206 || !contentRangeMatches(response, range, context.file.sizeBytes)) {
        throw new OfflineAiDownloadError('http-error', 'Private AI server returned an invalid byte range')
      }
      return response
    }))
    responses.push(...remainingResponses)

    const downloadedByRange = ranges.map(() => 0)
    await Promise.all(responses.map(async (response, rangeIndex) => {
      const segmentPath = segmentPaths[rangeIndex]!
      const writer = await this.fs.openWriter(segmentPath, 'truncate')
      try {
        for await (const chunk of response.body) {
          await writer.write(chunk)
          downloadedByRange[rangeIndex] = (downloadedByRange[rangeIndex] ?? 0) + chunk.byteLength
          const fileBytes = downloadedByRange.reduce((sum, value) => sum + value, 0)
          context.onProgress?.(this.progress({
            state: 'downloading',
            phase: 'downloading',
            manifest: context.manifest,
            file: context.file,
            fileIndex: context.fileIndex,
            fileCount: context.fileCount,
            fileBytes,
            completedBytes: context.completedBytes,
            totalBytes: context.totalBytes,
            message: 'Downloading Private AI',
          }))
          if (this.pauseRequested) return
        }
      } finally {
        await writer.close()
      }
    }))

    if (this.pauseRequested) return true

    for (let index = 0; index < ranges.length; index += 1) {
      const expectedSize = ranges[index]!.end - ranges[index]!.start + 1
      const actualSize = (await this.fs.stat(segmentPaths[index]!))?.size ?? -1
      if (actualSize !== expectedSize) {
        throw new OfflineAiDownloadError('size-mismatch', 'Private AI range size verification failed')
      }
    }

    const writer = await this.fs.openWriter(partPath, 'truncate')
    try {
      for (const segmentPath of segmentPaths) {
        for await (const chunk of this.fs.readChunks(segmentPath)) await writer.write(chunk)
      }
    } finally {
      await writer.close()
    }
    await Promise.all(segmentPaths.map((path) => this.fs.remove(path)))
    return false
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