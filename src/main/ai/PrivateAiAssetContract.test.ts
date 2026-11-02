import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// IBM Granite 4.0 1B (transformer, not the hybrid "H" model), Q4_K_M from ibm-granite/granite-4.0-1b-GGUF.
// Chosen over Qwen3.5 0.8B after a local benchmark on the Elder Companion prompts: it used the memories
// more reliably and invented fewer details.
const ANSWER_MODEL = {
  url: 'https://familycircle.o2gventures.com/private-ai/models/granite-4.0-1b-Q4_K_M.gguf',
  targetPath: 'models/granite-4.0-1b-Q4_K_M.gguf',
  sha256: '22EC0F9CC99A90185312DE3C882C84E7BD6789BDD050389844380A01A831D7F1',
  sizeBytes: 1_023_645_440,
} as const

// llama.cpp b8772 could not load the earlier Qwen3.5 GGUF; b11243 loads both Qwen3.5 and Granite 4.0.
const AI_ENGINE = {
  url: 'https://familycircle.o2gventures.com/private-ai/bin/llama-b11243-bin-win-cpu-x64.zip',
  targetPath: 'bin/llama-b11243-bin-win-cpu-x64',
  sha256: '29F91327F4E98FCAC93E3B44E6CC54BEDA26468EB9FFEB804A08CFA67BDA8C5B',
  sizeBytes: 19_161_151,
} as const

describe('Private AI asset contract', () => {
  it('pins Granite 4.0 1B Q4_K_M as the only required generation model', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../config/offline-ai-manifest.json'), 'utf8')) as {
      version: string
      files: Array<Record<string, unknown>>
    }
    const generators = manifest.files.filter((file) => file.type === 'model' || file.type === 'fast-model')

    expect(manifest.version).toBe('1.4.0')
    expect(generators).toEqual([
      expect.objectContaining({ ...ANSWER_MODEL, type: 'model', required: true, extract: false }),
    ])
    expect(JSON.stringify(manifest)).not.toMatch(/Qwen|granite-4\.0-h-|granite-4\.0-350m/i)
  })

  it('pins a llama.cpp engine that can load the answer model', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../config/offline-ai-manifest.json'), 'utf8')) as {
      files: Array<Record<string, unknown>>
    }
    expect(manifest.files.filter((file) => file.type === 'runtime')).toEqual([
      expect.objectContaining({ ...AI_ENGINE, extract: true, required: true }),
    ])
  })
})
