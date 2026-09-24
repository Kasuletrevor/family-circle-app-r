import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const QWEN_MODEL = {
  url: 'https://familycircle.o2gventures.com/private-ai/models/Qwen_Qwen3.5-0.8B-Q4_K_M.gguf',
  targetPath: 'models/Qwen_Qwen3.5-0.8B-Q4_K_M.gguf',
  sha256: 'FB044E93939A70469C905781334F5DE1E6C8B608CED6CBC8C9249BD4127D9526',
  sizeBytes: 579_615_840,
} as const

describe('Qwen Private AI asset contract', () => {
  it('pins Qwen3.5 0.8B Q4_K_M as the only required generation model', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../config/offline-ai-manifest.json'), 'utf8')) as {
      version: string
      files: Array<Record<string, unknown>>
    }
    const generators = manifest.files.filter((file) => file.type === 'model' || file.type === 'fast-model')

    expect(manifest.version).toBe('1.2.0')
    expect(generators).toEqual([
      expect.objectContaining({ ...QWEN_MODEL, type: 'model', required: true, extract: false }),
    ])
    expect(JSON.stringify(manifest)).not.toMatch(/h-micro|granite-4\.0-350m/i)
  })
})
