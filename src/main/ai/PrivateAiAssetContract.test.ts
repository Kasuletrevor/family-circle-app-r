import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const QWEN_MODEL = {
  url: 'https://familycircle.o2gventures.com/private-ai/models/Qwen_Qwen3.5-0.8B-Q4_K_M.gguf',
  targetPath: 'models/Qwen_Qwen3.5-0.8B-Q4_K_M.gguf',
  sha256: 'FB044E93939A70469C905781334F5DE1E6C8B608CED6CBC8C9249BD4127D9526',
  sizeBytes: 579_615_840,
} as const

// llama.cpp b8772 cannot load this Qwen3.5 GGUF: it counts the next-token-prediction
// layer (block_count 25, nextn_predict_layers 1) as a regular layer and fails with
// "missing tensor 'blk.24.ssm_conv1d.weight'". b11243 loads it and answers correctly.
const AI_ENGINE = {
  url: 'https://familycircle.o2gventures.com/private-ai/bin/llama-b11243-bin-win-cpu-x64.zip',
  targetPath: 'bin/llama-b11243-bin-win-cpu-x64',
  sha256: '29F91327F4E98FCAC93E3B44E6CC54BEDA26468EB9FFEB804A08CFA67BDA8C5B',
  sizeBytes: 19_161_151,
} as const

describe('Qwen Private AI asset contract', () => {
  it('pins Qwen3.5 0.8B Q4_K_M as the only required generation model', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../config/offline-ai-manifest.json'), 'utf8')) as {
      version: string
      files: Array<Record<string, unknown>>
    }
    const generators = manifest.files.filter((file) => file.type === 'model' || file.type === 'fast-model')

    expect(manifest.version).toBe('1.3.0')
    expect(generators).toEqual([
      expect.objectContaining({ ...QWEN_MODEL, type: 'model', required: true, extract: false }),
    ])
    expect(JSON.stringify(manifest)).not.toMatch(/h-micro|granite-4\.0-350m/i)
  })

  it('pins a llama.cpp engine that can load the Qwen3.5 GGUF', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../config/offline-ai-manifest.json'), 'utf8')) as {
      files: Array<Record<string, unknown>>
    }
    expect(manifest.files.filter((file) => file.type === 'runtime')).toEqual([
      expect.objectContaining({ ...AI_ENGINE, extract: true, required: true }),
    ])
  })
})
