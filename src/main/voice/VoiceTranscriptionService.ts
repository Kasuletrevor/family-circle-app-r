import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeStoryLanguage, type StoryLanguage } from '../../shared/story'
import type { InstalledVoicePaths } from './voiceModels'

export const MAX_VOICE_WAV_BYTES = 25 * 1024 * 1024
const TRANSCRIPTION_TIMEOUT_MS = 120_000

export type VoiceTranscriptionErrorCode =
  | 'invalid-audio'
  | 'too-large'
  | 'unsupported-language'
  | 'voice-not-ready'
  | 'busy'
  | 'timeout'
  | 'transcription-failed'

export class VoiceTranscriptionError extends Error {
  constructor(public readonly code: VoiceTranscriptionErrorCode, message: string) {
    super(message)
    this.name = 'VoiceTranscriptionError'
  }
}

interface VoiceAssetsPort {
  getInstalledPaths(): Promise<InstalledVoicePaths | null>
}

export interface WhisperProcessInput {
  executable: string
  args: string[]
  wavPath: string
  outputBase: string
  timeoutMs: number
}

interface VoiceProcessPort {
  run(input: WhisperProcessInput): Promise<string>
}

type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: { windowsHide: boolean; stdio: ['ignore','ignore','ignore'] },
) => ChildProcess

interface WhisperProcessRunnerDependencies {
  spawnProcess?: SpawnProcess
  readText?: (path: string) => Promise<string>
}

export class WhisperProcessRunner implements VoiceProcessPort {
  private readonly spawnProcess: SpawnProcess
  private readonly readText: (path: string) => Promise<string>

  constructor(dependencies: WhisperProcessRunnerDependencies = {}) {
    this.spawnProcess = dependencies.spawnProcess ?? ((executable, args, options) => spawn(executable, args, options))
    this.readText = dependencies.readText ?? ((path) => readFile(path, 'utf8'))
  }

  run(input: WhisperProcessInput): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      let settled = false
      let child: ChildProcess
      try {
        child = this.spawnProcess(input.executable, input.args, {
          windowsHide: true,
          stdio: ['ignore','ignore','ignore'],
        })
      } catch {
        reject(new VoiceTranscriptionError('transcription-failed', 'Voice transcription failed'))
        return
      }

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try { child.kill() } catch { /* best effort */ }
        reject(new VoiceTranscriptionError('timeout', 'Voice transcription timed out'))
      }, input.timeoutMs)

      const finishFailure = (error: VoiceTranscriptionError) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }

      child.once('error', () => finishFailure(new VoiceTranscriptionError('transcription-failed', 'Voice transcription failed')))
      child.once('exit', (code) => {
        if (settled) return
        if (code !== 0) {
          finishFailure(new VoiceTranscriptionError('transcription-failed', 'Voice transcription failed'))
          return
        }
        settled = true
        clearTimeout(timer)
        void this.readText(`${input.outputBase}.txt`).then(
          (value) => resolvePromise(value),
          () => reject(new VoiceTranscriptionError('transcription-failed', 'Voice transcription failed')),
        )
      })
    })
  }
}

interface VoiceTranscriptionServiceDependencies {
  userDataPath: string
  assets: VoiceAssetsPort
  processRunner?: VoiceProcessPort
  threads?: number
}

function requirePcmWav(wavBytes: Uint8Array): Buffer {
  if (wavBytes.byteLength > MAX_VOICE_WAV_BYTES) {
    throw new VoiceTranscriptionError('too-large', 'Voice recording exceeds the size limit')
  }
  const buffer = Buffer.from(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength)
  if (buffer.length < 44
    || buffer.subarray(0, 4).toString('ascii') !== 'RIFF'
    || buffer.subarray(8, 12).toString('ascii') !== 'WAVE') {
    throw new VoiceTranscriptionError('invalid-audio', 'Voice recording is invalid')
  }

  let offset = 12
  let validFormat = false
  let hasData = false
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.subarray(offset, offset + 4).toString('ascii')
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + chunkSize
    if (dataEnd > buffer.length) throw new VoiceTranscriptionError('invalid-audio', 'Voice recording is invalid')

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw new VoiceTranscriptionError('invalid-audio', 'Voice recording is invalid')
      const audioFormat = buffer.readUInt16LE(dataStart)
      const channels = buffer.readUInt16LE(dataStart + 2)
      const sampleRate = buffer.readUInt32LE(dataStart + 4)
      const bitsPerSample = buffer.readUInt16LE(dataStart + 14)
      validFormat = audioFormat === 1 && channels === 1 && sampleRate === 16_000 && bitsPerSample === 16
    } else if (chunkId === 'data') {
      hasData = chunkSize > 0
    }
    offset = dataEnd + (chunkSize % 2)
  }
  if (!validFormat || !hasData) throw new VoiceTranscriptionError('invalid-audio', 'Voice recording is invalid')
  return Buffer.from(buffer)
}

function boundedThreads(value?: number): number {
  const requested = Number.isFinite(value) ? Math.floor(value!) : Math.max(1, availableParallelism() - 1)
  return Math.max(1, Math.min(4, requested))
}

export class VoiceTranscriptionService {
  private readonly processRunner: VoiceProcessPort
  private readonly threads: number
  private busy = false

  constructor(private readonly dependencies: VoiceTranscriptionServiceDependencies) {
    this.processRunner = dependencies.processRunner ?? new WhisperProcessRunner()
    this.threads = boundedThreads(dependencies.threads)
  }

  async transcribe(input: { wavBytes: Uint8Array; language: StoryLanguage }): Promise<{ transcript: string }> {
    if (this.busy) throw new VoiceTranscriptionError('busy', 'Voice transcription is already running')
    this.busy = true

    let wavPath: string | null = null
    let outputBase: string | null = null
    try {
      const wav = requirePcmWav(input.wavBytes)
      let language
      try {
        language = normalizeStoryLanguage(input.language)
      } catch {
        throw new VoiceTranscriptionError('unsupported-language', 'Story language is not supported for voice transcription')
      }

      const paths = await this.dependencies.assets.getInstalledPaths()
      if (!paths) throw new VoiceTranscriptionError('voice-not-ready', 'Offline voice is not ready')

      const temporaryRoot = join(this.dependencies.userDataPath, 'offline-voice', 'tmp')
      await mkdir(temporaryRoot, { recursive: true })
      const requestId = randomUUID()
      wavPath = join(temporaryRoot, `${requestId}.wav`)
      outputBase = join(temporaryRoot, `${requestId}-transcript`)
      await writeFile(wavPath, wav)

      const args = [
        '-m', paths.model,
        '-f', wavPath,
        '-l', language.whisperCode,
        '-t', String(this.threads),
        '-otxt',
        '-of', outputBase,
        '-np',
      ]
      let rawTranscript: string
      try {
        rawTranscript = await this.processRunner.run({
          executable: paths.executable,
          args,
          wavPath,
          outputBase,
          timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
        })
      } catch (error) {
        if (error instanceof VoiceTranscriptionError && error.code === 'timeout') throw error
        throw new VoiceTranscriptionError('transcription-failed', 'Voice transcription failed')
      }
      return { transcript: rawTranscript.trim() }
    } finally {
      this.busy = false
      if (wavPath) await rm(wavPath, { force: true }).catch(() => undefined)
      if (outputBase) await rm(`${outputBase}.txt`, { force: true }).catch(() => undefined)
    }
  }
}
