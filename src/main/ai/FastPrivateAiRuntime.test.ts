import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AiRuntimeManager } from './AiRuntimeManager'
import { FastGraniteClient } from './FastGraniteClient'
import type { InstalledAiPaths } from './privateAiModels'

const FAST_MODEL = {
  url: 'https://huggingface.co/ibm-granite/granite-4.0-350m-GGUF/resolve/main/granite-4.0-350m-Q4_K_M.gguf?download=true',
  targetPath: 'models/granite-4.0-350m-Q4_K_M.gguf',
  sha256: '771C588A49607F274A2BBA3185733607EBE6F74B996AB90E2D6BEE0D98BCEC52',
  sizeBytes: 236_985_760,
} as const

const INSTALLED = {
  llamaDir: 'C:/FamilyCircle/offline-ai/bin/runtime',
  serverExe: 'C:/FamilyCircle/offline-ai/bin/runtime/llama-server.exe',
  graniteModel: 'C:/FamilyCircle/offline-ai/models/granite-micro.gguf',
  fastGraniteModel: 'C:/FamilyCircle/offline-ai/models/granite-350m.gguf',
  nomicModel: 'C:/FamilyCircle/offline-ai/models/nomic.gguf',
} satisfies InstalledAiPaths

class FakeChild {
  kill(): boolean { return true }
  once(): this { return this }
}

describe('fast Private AI asset and runtime contract', () => {
  it('pins Granite 4.0 350M Q4_K_M as a required verified asset', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../config/offline-ai-manifest.json'), 'utf8')) as {
      version: string
      files: Array<Record<string, unknown>>
    }
    const fast = manifest.files.find((file) => file.type === 'fast-model')

    expect(manifest.version).toBe('1.1.0')
    expect(fast).toMatchObject({ ...FAST_MODEL, required: true, extract: false })
  })

  it('starts the fast model on its own loopback server with a small context', async () => {
    const process = { spawn: vi.fn(() => new FakeChild()) }
    const health = { check: vi.fn(async () => true) }
    const assets = { getInstalledPaths: vi.fn(async () => INSTALLED) }
    const manager = new AiRuntimeManager({ assets, process, health, sleep: async () => undefined, cpuCount: () => 4 })

    await expect(manager.ensureFastGenerationRuntime()).resolves.toBe(true)

    expect(process.spawn).toHaveBeenCalledTimes(1)
    expect(process.spawn.mock.calls[0]?.[1]).toEqual([
      '--model', INSTALLED.fastGraniteModel,
      '--host', '127.0.0.1',
      '--port', '8082',
      '--threads', '4',
      '--ctx-size', '2048',
    ])
  })
})

describe('FastGraniteClient', () => {
  it('caps normal grounded answers at 192 generated tokens', async () => {
    const http = {
      post: vi.fn(async () => ({ choices: [{ message: { content: 'A grounded answer.' } }] })),
    }
    const client = new FastGraniteClient({ http })

    await expect(client.generate('What did I say?', '[My Story] I said hello.')).resolves.toBe('A grounded answer.')

    expect(http.post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      max_tokens: 192,
      stream: false,
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: expect.stringMatching(/ONLY/i) }),
      ]),
    }))
  })

  it('uses a short translation request for multilingual retrieval', async () => {
    const http = {
      post: vi.fn(async () => ({ choices: [{ message: { content: 'Where was I born?' } }] })),
    }
    const client = new FastGraniteClient({ http })

    await expect(client.translateForRetrieval('¿Dónde nací?')).resolves.toBe('Where was I born?')

    expect(http.post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      max_tokens: 96,
      temperature: 0,
      stream: false,
    }))
  })
})
