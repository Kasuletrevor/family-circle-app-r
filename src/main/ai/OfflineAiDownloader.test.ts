import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OfflineAiDownloader } from './OfflineAiDownloader'
import type { OfflineAiManifest, OfflineAiManifestFile, PrivateAiProgress } from './privateAiModels'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex').toUpperCase()
}

function modelFile(contents: string, overrides: Partial<OfflineAiManifestFile> = {}): OfflineAiManifestFile {
  return {
    name: 'AI search',
    type: 'embedding',
    url: 'https://example.invalid/model.gguf',
    targetPath: 'models/model.gguf',
    sha256: sha256(contents),
    sizeBytes: Buffer.byteLength(contents),
    extract: false,
    required: true,
    ...overrides,
  }
}

function manifest(file: OfflineAiManifestFile): OfflineAiManifest {
  return { version: 'test-1', files: [file] }
}

class MemoryFs {
  readonly files = new Map<string, Buffer>()
  readonly operations: string[] = []

  seed(path: string, contents: string) {
    this.files.set(path, Buffer.from(contents))
  }

  text(path: string): string | null {
    return this.files.get(path)?.toString('utf8') ?? null
  }

  async stat(path: string): Promise<{ size: number } | null> {
    const value = this.files.get(path)
    return value ? { size: value.byteLength } : null
  }

  async mkdir(path: string): Promise<void> {
    this.operations.push(`mkdir:${path}`)
  }

  async truncate(path: string): Promise<void> {
    this.operations.push(`truncate:${path}`)
    this.files.set(path, Buffer.alloc(0))
  }

  async append(path: string, chunk: Uint8Array): Promise<void> {
    this.operations.push(`append:${path}:${chunk.byteLength}`)
    const existing = this.files.get(path) ?? Buffer.alloc(0)
    this.files.set(path, Buffer.concat([existing, Buffer.from(chunk)]))
  }

  async *readChunks(path: string): AsyncIterable<Uint8Array> {
    this.operations.push(`read:${path}`)
    const value = this.files.get(path)
    if (!value) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    const midpoint = Math.max(1, Math.floor(value.byteLength / 2))
    yield value.subarray(0, midpoint)
    if (midpoint < value.byteLength) yield value.subarray(midpoint)
  }

  async rename(from: string, to: string): Promise<void> {
    this.operations.push(`rename:${from}->${to}`)
    const value = this.files.get(from)
    if (!value) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    this.files.set(to, value)
    this.files.delete(from)
  }

  async remove(path: string): Promise<void> {
    this.operations.push(`remove:${path}`)
    this.files.delete(path)
  }
}

function response(statusCode: number, chunks: string[]) {
  return {
    statusCode,
    headers: {},
    body: (async function* () {
      for (const chunk of chunks) yield Buffer.from(chunk)
    })(),
  }
}

function makeDownloader(httpResponse: ReturnType<typeof response>) {
  const fs = new MemoryFs()
  const http = { request: vi.fn(async () => httpResponse) }
  const extractionOperations: string[] = []
  const archive = {
    extractZip: vi.fn(async (zipPath: string, destinationPath: string) => {
      extractionOperations.push(`extract:${zipPath}->${destinationPath}`)
    }),
  }
  const downloader = new OfflineAiDownloader({ fs, http, archive })
  return { downloader, fs, http, archive, extractionOperations }
}

describe('OfflineAiDownloader', () => {
  it('resumes .part via Range bytes=<existing>-', async () => {
    const file = modelFile('abcdef')
    const root = '/private/offline-ai'
    const partPath = join(root, '.staging', 'test-1', 'models/model.gguf.part')
    const finalPath = join(root, 'models/model.gguf')
    const { downloader, fs, http } = makeDownloader(response(206, ['def']))
    fs.seed(partPath, 'abc')

    await downloader.downloadAll(manifest(file), root)

    expect(http.request.mock.calls[0]?.[1]).toMatchObject({ headers: { Range: 'bytes=3-' } })
    expect(fs.text(finalPath)).toBe('abcdef')
    expect(fs.text(partPath)).toBeNull()
  })

  it('restarts when server ignores resume', async () => {
    const file = modelFile('abcdef')
    const root = '/private/offline-ai'
    const partPath = join(root, '.staging', 'test-1', 'models/model.gguf.part')
    const finalPath = join(root, 'models/model.gguf')
    const { downloader, fs } = makeDownloader(response(200, ['abcdef']))
    fs.seed(partPath, 'abc')

    await downloader.downloadAll(manifest(file), root)

    expect(fs.operations).toContain(`truncate:${partPath}`)
    expect(fs.text(finalPath)).toBe('abcdef')
  })

  it('emits aggregate/per-file progress', async () => {
    const file = modelFile('abcdef')
    const root = '/private/offline-ai'
    const { downloader } = makeDownloader(response(200, ['abc', 'def']))
    const progress: PrivateAiProgress[] = []

    await downloader.downloadAll(manifest(file), root, (event) => progress.push(event))

    expect(progress.some((event) => event.phase === 'downloading' && event.fileBytesDownloaded === 3 && event.bytesDownloaded === 3)).toBe(true)
    expect(progress.at(-1)).toMatchObject({
      state: 'verifying',
      fileIndex: 1,
      fileCount: 1,
      fileName: 'AI search',
      fileBytesDownloaded: 6,
      bytesDownloaded: 6,
      totalBytes: 6,
      percent: 100,
    })
    expect(JSON.stringify(progress)).not.toContain(file.url)
    expect(JSON.stringify(progress)).not.toContain(root)
  })

  it('pause keeps valid partial bytes', async () => {
    const file = modelFile('abcdef')
    const root = '/private/offline-ai'
    const partPath = join(root, '.staging', 'test-1', 'models/model.gguf.part')
    const { downloader, fs } = makeDownloader(response(200, ['abc', 'def']))

    const result = await downloader.downloadAll(manifest(file), root, (event) => {
      if (event.phase === 'downloading' && event.fileBytesDownloaded === 3) downloader.pause()
    })

    expect(result).toEqual({ paused: true })
    expect(fs.text(partPath)).toBe('abc')
    expect(fs.operations.some((operation) => operation.startsWith('rename:'))).toBe(false)
  })

  it('rejects size mismatch', async () => {
    const file = modelFile('abcdef')
    const { downloader } = makeDownloader(response(200, ['abcde']))

    await expect(downloader.downloadAll(manifest(file), '/private/offline-ai')).rejects.toMatchObject({ code: 'size-mismatch' })
  })

  it('rejects SHA mismatch', async () => {
    const file = modelFile('abcdef', { sha256: sha256('different') })
    const { downloader } = makeDownloader(response(200, ['abcdef']))

    await expect(downloader.downloadAll(manifest(file), '/private/offline-ai')).rejects.toMatchObject({ code: 'sha-mismatch' })
  })

  it('promotes only verified files', async () => {
    const file = modelFile('abcdef', { sha256: sha256('different') })
    const root = '/private/offline-ai'
    const finalPath = join(root, 'models/model.gguf')
    const { downloader, fs } = makeDownloader(response(200, ['abcdef']))

    await expect(downloader.downloadAll(manifest(file), root)).rejects.toMatchObject({ code: 'sha-mismatch' })
    expect(fs.text(finalPath)).toBeNull()
    expect(fs.operations.some((operation) => operation.endsWith(`->${finalPath}`))).toBe(false)
  })

  it('extracts runtime only after zip verification', async () => {
    const zipBytes = 'verified-runtime-zip'
    const runtime = modelFile(zipBytes, {
      name: 'AI engine',
      type: 'runtime',
      url: 'https://example.invalid/runtime.zip',
      targetPath: 'bin/runtime',
      extract: true,
    })
    const root = '/private/offline-ai'
    const { downloader, fs, archive, extractionOperations } = makeDownloader(response(200, [zipBytes]))

    await downloader.downloadAll(manifest(runtime), root)

    expect(archive.extractZip).toHaveBeenCalledTimes(1)
    const readIndex = fs.operations.findIndex((operation) => operation.startsWith('read:'))
    expect(readIndex).toBeGreaterThanOrEqual(0)
    expect(extractionOperations).toHaveLength(1)

    const invalidRuntime = { ...runtime, sha256: sha256('wrong') }
    const invalid = makeDownloader(response(200, [zipBytes]))
    await expect(invalid.downloader.downloadAll(manifest(invalidRuntime), root)).rejects.toMatchObject({ code: 'sha-mismatch' })
    expect(invalid.archive.extractZip).not.toHaveBeenCalled()
  })
})
