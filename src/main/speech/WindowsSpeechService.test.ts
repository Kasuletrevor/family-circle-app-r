import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_SPOKEN_CHARS, WindowsSpeechService, type SpeechScriptRunner } from './WindowsSpeechService'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'family-circle-speech-'))
  roots.push(root)
  return root
}

function fakeRunner(handler: (env: Record<string, string>) => Promise<{ exitCode: number; stdout: string }>) {
  const runner: SpeechScriptRunner & { calls: Array<{ script: string; env: Record<string, string> }> } = {
    calls: [],
    async run(script, env) {
      runner.calls.push({ script, env })
      return handler(env)
    },
  }
  return runner
}

describe('WindowsSpeechService', () => {
  it('lists installed voices once and caches them', async () => {
    const runner = fakeRunner(async () => ({ exitCode: 0, stdout: 'VOICE\tMicrosoft David\ten-US\r\nVOICE\tMicrosoft Hortense\tfr-FR\r\nnoise\r\n' }))
    const service = new WindowsSpeechService({ tempPath: await tempPath(), platform: 'win32', runner })

    await expect(service.listVoices()).resolves.toEqual([
      { name: 'Microsoft David', language: 'en-US' },
      { name: 'Microsoft Hortense', language: 'fr-FR' },
    ])
    await service.listVoices()
    expect(runner.calls).toHaveLength(1)
  })

  it('passes the answer text only through the environment, never inside the script', async () => {
    const root = await tempPath()
    const text = "Rose's key'; Remove-Item C:\\ -Recurse #"
    const runner = fakeRunner(async (env) => {
      await writeFile(env.FC_SPEECH_OUT!, Buffer.from('RIFFfakewav'))
      return { exitCode: 0, stdout: 'SPOKEN\tMicrosoft David\r\n' }
    })
    const service = new WindowsSpeechService({ tempPath: root, platform: 'win32', runner })

    const result = await service.synthesize({ text, language: 'en' })

    expect(result).toMatchObject({ status: 'ok', voiceName: 'Microsoft David' })
    expect(Buffer.from((result as { wavBytes: Uint8Array }).wavBytes).toString()).toBe('RIFFfakewav')
    expect(runner.calls[0]!.env).toMatchObject({ FC_SPEECH_MODE: 'speak', FC_SPEECH_LOCALE: 'en-US', FC_SPEECH_TEXT: text })
    expect(runner.calls[0]!.script).not.toContain('Remove-Item')
  })

  it('reports when no voice is installed for the language and cleans up', async () => {
    const runner = fakeRunner(async () => ({ exitCode: 3, stdout: '' }))
    const service = new WindowsSpeechService({ tempPath: await tempPath(), platform: 'win32', runner })
    await expect(service.synthesize({ text: 'Bonjour', language: 'fr' })).resolves.toEqual({ status: 'no-voice' })
    expect(runner.calls[0]!.env.FC_SPEECH_LOCALE).toBe('fr-FR')
  })

  it('limits the spoken text and rejects unsupported languages', async () => {
    const runner = fakeRunner(async () => ({ exitCode: 3, stdout: '' }))
    const service = new WindowsSpeechService({ tempPath: await tempPath(), platform: 'win32', runner })
    await service.synthesize({ text: 'word '.repeat(2_000), language: 'en' })
    expect(runner.calls[0]!.env.FC_SPEECH_TEXT!.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS)
    await expect(service.synthesize({ text: 'Hi', language: 'xx' })).rejects.toThrow()
  })

  it('is unavailable outside Windows', async () => {
    const runner = fakeRunner(vi.fn())
    const service = new WindowsSpeechService({ tempPath: await tempPath(), platform: 'linux', runner })
    await expect(service.listVoices()).resolves.toEqual([])
    await expect(service.synthesize({ text: 'Hi', language: 'en' })).resolves.toEqual({ status: 'unsupported' })
    expect(runner.calls).toHaveLength(0)
  })
})

// Exercises the real Windows speech engine (also on the windows-latest packaging job).
describe.runIf(process.platform === 'win32')('WindowsSpeechService on Windows', () => {
  it('lists real voices and synthesises a WAV when an English voice is installed', async () => {
    const service = new WindowsSpeechService({ tempPath: await tempPath() })
    const voices = await service.listVoices()
    if (!voices.some((voice) => voice.language.startsWith('en'))) return

    const result = await service.synthesize({ text: 'Rose worked at Mulago Hospital.', language: 'en' })
    expect(result.status).toBe('ok')
    const wav = Buffer.from((result as { wavBytes: Uint8Array }).wavBytes)
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.length).toBeGreaterThan(10_000)
  }, 60_000)
})
