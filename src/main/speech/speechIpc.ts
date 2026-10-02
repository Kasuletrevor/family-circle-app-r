import type { SpeechPublicResult, SpokenVoicePublic } from '../../shared/desktopApi'
import { normalizeStoryLanguage } from '../../shared/story'
import type { IpcHandleRegistrar } from '../auth/authIpc'
import { MAX_SPOKEN_CHARS, type SpeechResult, type SpokenVoice } from './WindowsSpeechService'

export interface SpeechIpcService {
  listVoices(): Promise<SpokenVoice[]>
  synthesize(input: { text: string; language: string }): Promise<SpeechResult>
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function synthesizeInputOf(payload: unknown): { text: string; language: string } {
  const raw = recordOf(payload)
  const text = String(raw.text ?? '').slice(0, MAX_SPOKEN_CHARS * 2)
  if (!text.trim()) throw new Error('Nothing to read aloud')
  return { text, language: normalizeStoryLanguage(raw.language).code }
}

function publicResult(result: SpeechResult): SpeechPublicResult {
  if (result.status === 'ok') {
    return { status: 'ok', wavBytes: new Uint8Array(result.wavBytes), voiceName: String(result.voiceName ?? '') }
  }
  return { status: result.status === 'no-voice' ? 'no-voice' : 'unsupported' }
}

export function registerSpeechIpc(ipc: IpcHandleRegistrar, speech: SpeechIpcService) {
  ipc.handle('speech:list-voices', async (): Promise<SpokenVoicePublic[]> => (
    (await speech.listVoices()).map((voice) => ({ name: String(voice.name), language: String(voice.language) }))
  ))
  ipc.handle('speech:synthesize', async (_event, payload) => publicResult(await speech.synthesize(synthesizeInputOf(payload))))
}
