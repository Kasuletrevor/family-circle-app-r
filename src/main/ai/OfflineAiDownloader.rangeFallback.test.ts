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

function partialResponse(contents: string, start: number, end: number, total: number) {
  return {
    statusCode: 206,
    headers: {
      'content-range': `bytes ${start}-${end}/${total}`,
      etag: '"model-v1"',
    },
    body: (async function* () {
      yield Buffer.from(contents.slice(start, end + 1))
    })(),
  }
}

function fullResponse(contents: string) {
  return {
    statusCode: 200,
    headers: { etag: '"model-v2"' },
    body: (async function* () {
      yield Buffer.from(contents)
    })(),
  }
}

describe('OfflineAiDownloader late range fallback', () => {
  it('uses a later full response safely when the server stops honoring parallel ranges', async () => {
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
    const manifest: OfflineAiManifest = { version: 'test-late-fallback', files: [file] }
    const root = resolve('private', 'offline-ai')
    const fs = new MemoryFs()
    const seen: Array<{ range: string | undefined; ifRange: string | undefined }> = []
    const http = {
      request: vi.fn(async (_url: string, options: { headers: Record<string, string> }) => {
        const range = options.headers.Range
        seen.push({ range, ifRange: options.headers['If-Range'] })
        if (range === 'bytes=0-3') return partialResponse(contents, 0, 3, contents.length)
        if (range === 'bytes=4-7') return fullResponse(contents)
        const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '')
        if (!match) throw new Error(`unexpected range ${range}`)
        return partialResponse(contents, Number(match[1]), Number(match[2]), contents.length)
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

    expect(seen.some((request) => request.range === 'bytes=4-7' && request.ifRange === '"model-v1"')).toBe(true)
    expect(fs.text(join(root, 'models/model.gguf'))).toBe(contents)
  })
})
