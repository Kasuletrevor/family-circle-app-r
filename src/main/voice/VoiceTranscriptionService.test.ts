import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_VOICE_WAV_BYTES,
  VoiceTranscriptionError,
  VoiceTranscriptionService,
  WhisperProcessRunner,
} from './VoiceTranscriptionService'

const roots: string[] = []
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'family-circle-transcribe-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function pcmWav(sampleBytes = 320): Uint8Array {
  const data = Buffer.alloc(sampleBytes)
  const wav = Buffer.alloc(44 + data.length)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + data.length, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16_000, 24)
  wav.writeUInt32LE(32_000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(data.length, 40)
  data.copy(wav, 44)
  return wav
}

function installed(root: string) {
  return {
    runtimeDir: join(root, 'offline-voice', 'runtime', 'whisper-v1.9.1-win-x64'),
    executable: join(root, 'offline-voice', 'runtime', 'whisper-v1.9.1-win-x64', 'Release', 'whisper-cli.exe'),
    model: join(root, 'offline-voice', 'models', 'ggml-base.bin'),
  }
}

describe('VoiceTranscriptionService', () => {
  it('rejects non-WAV, non-PCM, wrong format, oversized, and unavailable voice inputs before process dispatch', async () => {
    const root = await tempRoot()
    const run = vi.fn(async () => 'never')
    const service = new VoiceTranscriptionService({
      userDataPath: root,
      assets: { getInstalledPaths: vi.fn(async () => installed(root)) },
      processRunner: { run },
      threads: 2,
    })

    await expect(service.transcribe({ wavBytes: new Uint8Array([1,2,3]), language: 'en' })).rejects.toMatchObject({ code: 'invalid-audio' })

    const stereo = Buffer.from(pcmWav())
    stereo.writeUInt16LE(2, 22)
    await expect(service.transcribe({ wavBytes: stereo, language: 'en' })).rejects.toMatchObject({ code: 'invalid-audio' })

    const wrongRate = Buffer.from(pcmWav())
    wrongRate.writeUInt32LE(44_100, 24)
    await expect(service.transcribe({ wavBytes: wrongRate, language: 'en' })).rejects.toMatchObject({ code: 'invalid-audio' })

    await expect(service.transcribe({ wavBytes: new Uint8Array(MAX_VOICE_WAV_BYTES + 1), language: 'en' })).rejects.toMatchObject({ code: 'too-large' })
    await expect(service.transcribe({ wavBytes: pcmWav(), language: 'xx' as any })).rejects.toMatchObject({ code: 'unsupported-language' })
    expect(run).not.toHaveBeenCalled()

    const unavailable = new VoiceTranscriptionService({
      userDataPath: root,
      assets: { getInstalledPaths: vi.fn(async () => null) },
      processRunner: { run },
    })
    await expect(unavailable.transcribe({ wavBytes: pcmWav(), language: 'en' })).rejects.toMatchObject({ code: 'voice-not-ready' })
    expect(run).not.toHaveBeenCalled()
  })

  it('maps all seven Story languages to fixed Whisper language arguments, including fil -> tl', async () => {
    const root = await tempRoot()
    const calls: string[][] = []
    const service = new VoiceTranscriptionService({
      userDataPath: root,
      assets: { getInstalledPaths: vi.fn(async () => installed(root)) },
      processRunner: {
        run: vi.fn(async (input) => {
          calls.push(input.args)
          expect(await readFile(input.wavPath)).toEqual(Buffer.from(pcmWav()))
          return '  Local transcript  '
        }),
      },
      threads: 3,
    })

    const cases = [
      ['en','en'], ['fr','fr'], ['es','es'], ['pt','pt'], ['zh','zh'], ['ja','ja'], ['fil','tl'],
    ] as const
    for (const [language, whisper] of cases) {
      await expect(service.transcribe({ wavBytes: pcmWav(), language })).resolves.toEqual({ transcript: 'Local transcript' })
      const args = calls.at(-1)!
      expect(args).toEqual([
        '-m', installed(root).model,
        '-f', expect.stringMatching(/\.wav$/),
        '-l', whisper,
        '-t', '3',
        '-otxt',
        '-of', expect.any(String),
        '-np',
      ])
    }
  })

  it('accepts no executable/model/path/flags from the caller and cleans temporary audio on success and failure', async () => {
    const root = await tempRoot()
    const paths = installed(root)
    let invocation: any
    const service = new VoiceTranscriptionService({
      userDataPath: root,
      assets: { getInstalledPaths: vi.fn(async () => paths) },
      processRunner: {
        run: vi.fn(async (input) => {
          invocation = input
          return 'Safe transcript'
        }),
      },
      threads: 99,
    })

    await service.transcribe({ wavBytes: pcmWav(), language: 'en', executable: 'evil.exe', model: 'evil.bin', flags: ['--evil'] } as any)
    expect(invocation.executable).toBe(paths.executable)
    expect(invocation.args[1]).toBe(paths.model)
    expect(invocation.args).not.toContain('evil.exe')
    expect(invocation.args).not.toContain('evil.bin')
    expect(invocation.args).not.toContain('--evil')
    expect(Number(invocation.args[invocation.args.indexOf('-t') + 1])).toBeLessThanOrEqual(4)
    expect(await readdir(join(root, 'offline-voice', 'tmp'))).toEqual([])

    const failing = new VoiceTranscriptionService({
      userDataPath: root,
      assets: { getInstalledPaths: vi.fn(async () => paths) },
      processRunner: { run: vi.fn(async () => { throw new Error('C:\\secret stderr') }) },
    })
    await expect(failing.transcribe({ wavBytes: pcmWav(), language: 'en' })).rejects.toMatchObject({
      code: 'transcription-failed',
      message: 'Voice transcription failed',
    })
    expect(await readdir(join(root, 'offline-voice', 'tmp'))).toEqual([])
  })

  it('rejects concurrent transcription with a busy guard and cleans up after the first request', async () => {
    const root = await tempRoot()
    let release!: (value: string) => void
    const blocked = new Promise<string>((resolvePromise) => { release = resolvePromise })
    const service = new VoiceTranscriptionService({
      userDataPath: root,
      assets: { getInstalledPaths: vi.fn(async () => installed(root)) },
      processRunner: { run: vi.fn(async () => blocked) },
    })

    const first = service.transcribe({ wavBytes: pcmWav(), language: 'en' })
    await expect(service.transcribe({ wavBytes: pcmWav(), language: 'en' })).rejects.toMatchObject({ code: 'busy' })
    release('first transcript')
    await expect(first).resolves.toEqual({ transcript: 'first transcript' })
    expect(await readdir(join(root, 'offline-voice', 'tmp'))).toEqual([])
  })

  it('kills whisper after 120 seconds, suppresses child output, and returns no stderr/path details', async () => {
    class FakeChild extends EventEmitter {
      killed = false
      kill(): boolean {
        this.killed = true
        this.emit('exit', null)
        return true
      }
    }
    const child = new FakeChild()
    const spawnProcess = vi.fn(() => child as any)
    const runner = new WhisperProcessRunner({ spawnProcess })
    vi.useFakeTimers()
    try {
      const pending = runner.run({
        executable: 'C:\\owned\\whisper-cli.exe',
        args: ['-m','C:\\owned\\model.bin'],
        wavPath: 'C:\\owned\\audio.wav',
        outputBase: 'C:\\owned\\out',
        timeoutMs: 120_000,
      })
      await vi.advanceTimersByTimeAsync(120_001)
      await expect(pending).rejects.toMatchObject({ code: 'timeout', message: 'Voice transcription timed out' })
      expect(child.killed).toBe(true)
      expect(spawnProcess).toHaveBeenCalledWith(
        'C:\\owned\\whisper-cli.exe',
        ['-m','C:\\owned\\model.bin'],
        expect.objectContaining({ windowsHide: true, stdio: ['ignore','ignore','ignore'] }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('contains no HTTP/fetch/request fallback in the transcription implementation', async () => {
    const source = await readFile(resolve(__dirname, 'VoiceTranscriptionService.ts'), 'utf8')
    expect(source).not.toMatch(/node:https?|\bfetch\s*\(|\brequest\s*\(/)
  })
})
