import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OfflineAiDownloader } from './OfflineAiDownloader'
import type { OfflineAiManifest, OfflineAiManifestFile } from './privateAiModels'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex').toUpperCase()
}

class MemoryFs {
  readonly files = new Map<string, Buffer>()

  seed(path: string, contents: string): void {
    this.files.set(path, Buffer.from(contents))
  }

  text(path: string): string | null {
    return this.files.get(path)?.toString('utf8') ?? null
  }

  async stat(path: string): Promise<{ size: number } | null> {
    const value = this.files.get(path)
    return value ? { size: value.byteLength } : null
  }

  async mkdir(): Promise<void> {}

  async truncate(path: string): Promise<void> {
    this.files.set(path, Buffer.alloc(0))
  }

  async openWriter(path: string, mode: 'append' | 'truncate') {
    if (mode === 'truncate') this.files.set(path, Buffer.alloc(0))
    return {
      write: async (chunk: Uint8Array) => {
        const existing = this.files.get(path) ?? Buffer.alloc(0)
        this.files.set(path, Buffer.concat([existing, Buffer.from(chunk)]))
      },
      close: async () => undefined,
    }
  }

  async *readChunks(path: string): AsyncIterable<Uint8Array> {
    const value = this.files.get(path)
    if (!value) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    yield value
  }

  async rename(from: string, to: string): Promise<void> {
    const value = this.files.get(from)
    if (!value) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    this.files.set(to, value)
    this.files.delete(from)
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
  }
}

function response(statusCode: number, contents: string, start: number, end: number, total: number) {
  return {
    statusCode,
    headers: {
      'content-range': `bytes ${start}-${end}/${total}`,
      etag: '"model-v1"',
    },
    body: (async function* () {
      yield Buffer.from(contents)
    })(),
  }
}

describe('OfflineAiDownloader parallel resume', () => {
  it('reuses complete range segments and resumes only the missing suffixes', async () => {
    const contents = 'abcdefghijklmnop'
    const file: OfflineAiManifestFile = {
      name: 'AI answers',
      type: 'model',
      url: 'https://example.invalid/model.gguf',
      targetPath: 'models/model.gguf',
      sha256: sha256(contents),
      sizeBytes: contents.length,
      extract: false,
      required: true,
    }
    const manifest: OfflineAiManifest = { version: 'test-resume', files: [file] }
    const root = resolve('private', 'offline-ai')
    const partPath = join(root, '.staging', 'test-resume', 'models/model.gguf.part')
    const finalPath = join(root, 'models/model.gguf')
    const fs = new MemoryFs()
    fs.seed(`${partPath}.range-0`, 'abcd')
    fs.seed(`${partPath}.range-1`, 'ef')

    const requestedRanges: string[] = []
    const http = {
      request: vi.fn(async (_url: string, options: { headers: Record<string, string> }) => {
        const range = options.headers.Range
        if (!range) throw new Error('parallel resume should stay range-based')
        requestedRanges.push(range)
        const match = /^bytes=(\d+)-(\d+)$/.exec(range)
        if (!match) throw new Error(`unexpected range ${range}`)
        const start = Number(match[1])
        const end = Number(match[2])
        return response(206, contents.slice(start, end + 1), start, end, contents.length)
      }),
    }
    const downloader = new OfflineAiDownloader({
      fs,
      http,
      archive: { extractZip: vi.fn() },
      parallelDownloadThresholdBytes: 8,
      maxParallelParts: 4,
    })

    await downloader.downloadAll(manifest, root)

    expect(requestedRanges).toEqual([
      'bytes=6-7',
      'bytes=8-11',
      'bytes=12-15',
    ])
    expect(fs.text(finalPath)).toBe(contents)
  })
})