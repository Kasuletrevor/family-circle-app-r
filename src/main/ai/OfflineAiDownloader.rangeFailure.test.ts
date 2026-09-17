import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OfflineAiDownloader } from './OfflineAiDownloader'
import type { OfflineAiManifest, OfflineAiManifestFile } from './privateAiModels'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex').toUpperCase()
}

class MemoryFs {
  readonly files = new Map<string, Buffer>()

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

function manifest(contents: string): OfflineAiManifest {
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
  return { version: 'test-range-failure', files: [file] }
}

describe('OfflineAiDownloader parallel failure cleanup', () => {
  it('cancels sibling range responses and waits for them to settle before returning a body failure', async () => {
    const contents = 'abcdefghijklmnop'
    const fs = new MemoryFs()
    const cancelSpies = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]
    const settled = [false, false, false, false]
    const cancelResolvers: Array<() => void> = []
    const cancelPromises = cancelSpies.map((spy, index) => new Promise<void>((resolve) => {
      cancelResolvers[index] = () => {
        spy()
        resolve()
      }
    }))

    const http = {
      request: vi.fn(async (_url: string, options: { headers: Record<string, string> }) => {
        const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range ?? '')
        if (!match) throw new Error('expected range request')
        const start = Number(match[1])
        const end = Number(match[2])
        const index = Math.floor(start / 4)
        return {
          statusCode: 206,
          headers: {
            'content-range': `bytes ${start}-${end}/${contents.length}`,
            etag: '"model-v1"',
          },
          cancel: () => cancelResolvers[index]?.(),
          body: (async function* () {
            try {
              if (index === 1) throw new Error('simulated network failure')
              await cancelPromises[index]
            } finally {
              settled[index] = true
            }
          })(),
        }
      }),
    }

    const downloader = new OfflineAiDownloader({
      fs,
      http,
      archive: { extractZip: vi.fn() },
      parallelDownloadThresholdBytes: 8,
      maxParallelParts: 4,
    })

    await expect(downloader.downloadAll(manifest(contents), resolve('private', 'offline-ai')))
      .rejects.toThrow('simulated network failure')

    expect(cancelSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true)
    expect(settled).toEqual([true, true, true, true])
  })
})
