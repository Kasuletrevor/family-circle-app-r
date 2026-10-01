import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRIVATE_AI_MODELS } from './privateAiModels'

function manifestUrls(file: string): string {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../config', file), 'utf8')) as { files: Array<{ url: string }> }
  return manifest.files.map((entry) => entry.url).join('\n')
}

describe('PRIVATE_AI_MODELS', () => {
  it('names the models the download manifests actually install', () => {
    const ai = manifestUrls('offline-ai-manifest.json')
    expect(PRIVATE_AI_MODELS.answers).toBe('Qwen3.5 0.8B')
    expect(ai).toContain('Qwen_Qwen3.5-0.8B')
    expect(PRIVATE_AI_MODELS.search).toBe('Nomic Embed Text v1.5')
    expect(ai).toContain('nomic-embed-text-v1.5')
    expect(PRIVATE_AI_MODELS.voice).toBe('Whisper base')
    expect(manifestUrls('offline-voice-manifest.json')).toContain('ggml-base.bin')
  })
})
