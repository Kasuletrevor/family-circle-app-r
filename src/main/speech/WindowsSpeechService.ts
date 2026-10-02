import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeStoryLanguage } from '../../shared/story'

export const MAX_SPOKEN_CHARS = 4_000

export interface SpokenVoice {
  name: string
  language: string
}

export type SpeechResult =
  | { status: 'ok'; wavBytes: Uint8Array; voiceName: string }
  | { status: 'no-voice' }
  | { status: 'unsupported' }

export class SpeechServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpeechServiceError'
  }
}

/** Runs a PowerShell script with inputs in environment variables only, never in the script text. */
export interface SpeechScriptRunner {
  run(script: string, env: Record<string, string>): Promise<{ exitCode: number; stdout: string }>
}

// Windows' built-in (OneCore) voices through WinRT — the voices Narrator uses. Fully offline.
const SPEECH_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
function Await($operation, [Type]$resultType) {
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + [char]96 + '1')
  } | Select-Object -First 1
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait() | Out-Null
  return $task.Result
}
$voices = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices
if ($env:FC_SPEECH_MODE -eq 'list') {
  $voices | ForEach-Object { 'VOICE' + [char]9 + $_.DisplayName + [char]9 + $_.Language }
  exit 0
}
$locale = $env:FC_SPEECH_LOCALE
$prefix = $locale.Split('-')[0]
$voice = $voices | Where-Object { $_.Language -eq $locale } | Select-Object -First 1
if (-not $voice) { $voice = $voices | Where-Object { $_.Language.StartsWith($prefix + '-') -or $_.Language -eq $prefix } | Select-Object -First 1 }
if (-not $voice) { exit 3 }
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$synth.Voice = $voice
$stream = Await ($synth.SynthesizeTextToStreamAsync($env:FC_SPEECH_TEXT)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
$size = [uint32]$stream.Size
$null = Await ($reader.LoadAsync($size)) ([uint32])
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)
[System.IO.File]::WriteAllBytes($env:FC_SPEECH_OUT, $bytes)
'SPOKEN' + [char]9 + $voice.DisplayName
`

class PowerShellRunner implements SpeechScriptRunner {
  run(script: string, env: Record<string, string>): Promise<{ exitCode: number; stdout: string }> {
    return new Promise((resolve, reject) => {
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, env: { ...process.env, ...env } },
      )
      let stdout = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      child.once('error', reject)
      child.once('exit', (code) => resolve({ exitCode: code ?? 1, stdout }))
    })
  }
}

interface WindowsSpeechServiceDependencies {
  tempPath: string
  platform?: NodeJS.Platform
  runner?: SpeechScriptRunner
}

/** Reads answers aloud with Windows' built-in voices, entirely on this computer. */
export class WindowsSpeechService {
  private readonly platform: NodeJS.Platform
  private readonly runner: SpeechScriptRunner
  private voicesCache: SpokenVoice[] | null = null

  constructor(private readonly dependencies: WindowsSpeechServiceDependencies) {
    this.platform = dependencies.platform ?? process.platform
    this.runner = dependencies.runner ?? new PowerShellRunner()
  }

  async listVoices(): Promise<SpokenVoice[]> {
    if (this.platform !== 'win32') return []
    if (this.voicesCache) return this.voicesCache
    const { exitCode, stdout } = await this.runner.run(SPEECH_SCRIPT, { FC_SPEECH_MODE: 'list' })
    if (exitCode !== 0) throw new SpeechServiceError('Could not list the voices on this computer')
    this.voicesCache = stdout.split(/\r?\n/)
      .filter((line) => line.startsWith('VOICE\t'))
      .map((line) => {
        const [, name = '', language = ''] = line.split('\t')
        return { name: name.trim(), language: language.trim() }
      })
      .filter((voice) => voice.name && voice.language)
    return this.voicesCache
  }

  async synthesize(input: { text: string; language: string }): Promise<SpeechResult> {
    if (this.platform !== 'win32') return { status: 'unsupported' }
    const language = normalizeStoryLanguage(input.language)
    const text = String(input.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SPOKEN_CHARS)
    if (!text) throw new SpeechServiceError('Nothing to read aloud')

    const folder = join(this.dependencies.tempPath, 'speech')
    await mkdir(folder, { recursive: true })
    const outPath = join(folder, `${randomUUID()}.wav`)
    try {
      const { exitCode, stdout } = await this.runner.run(SPEECH_SCRIPT, {
        FC_SPEECH_MODE: 'speak',
        FC_SPEECH_LOCALE: language.speechLocale,
        FC_SPEECH_TEXT: text,
        FC_SPEECH_OUT: outPath,
      })
      if (exitCode === 3) return { status: 'no-voice' }
      if (exitCode !== 0) throw new SpeechServiceError('Could not read the answer aloud')
      const voiceName = stdout.split(/\r?\n/).find((line) => line.startsWith('SPOKEN\t'))?.split('\t')[1]?.trim() ?? ''
      return { status: 'ok', wavBytes: new Uint8Array(await readFile(outPath)), voiceName }
    } finally {
      await rm(outPath, { force: true }).catch(() => undefined)
    }
  }
}
