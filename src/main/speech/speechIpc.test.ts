import { describe, expect, it, vi } from 'vitest'
import { registerSpeechIpc, type SpeechIpcService } from './speechIpc'

function register(service: SpeechIpcService) {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()
  registerSpeechIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, service)
  return (channel: string, payload?: unknown) => handlers.get(channel)!({}, payload)
}

describe('speech IPC', () => {
  it('lists voices with only their name and language', async () => {
    const call = register({
      listVoices: vi.fn(async () => [{ name: 'Microsoft Zira', language: 'en-US', path: 'C:/secret' } as never]),
      synthesize: vi.fn(),
    })
    await expect(call('speech:list-voices')).resolves.toEqual([{ name: 'Microsoft Zira', language: 'en-US' }])
  })

  it('validates the language and text before reading aloud', async () => {
    const synthesize = vi.fn(async () => ({ status: 'ok' as const, wavBytes: new Uint8Array([82, 73, 70, 70]), voiceName: 'Microsoft Zira' }))
    const call = register({ listVoices: vi.fn(), synthesize })

    await expect(call('speech:synthesize', { text: 'Hello', language: 'en' })).resolves.toEqual({
      status: 'ok', wavBytes: new Uint8Array([82, 73, 70, 70]), voiceName: 'Microsoft Zira',
    })
    expect(synthesize).toHaveBeenCalledWith({ text: 'Hello', language: 'en' })
    await expect(call('speech:synthesize', { text: 'Hello', language: 'klingon' })).rejects.toThrow()
    await expect(call('speech:synthesize', { text: '   ', language: 'en' })).rejects.toThrow('Nothing to read aloud')
  })

  it('passes through missing-voice results without extra fields', async () => {
    const call = register({ listVoices: vi.fn(), synthesize: vi.fn(async () => ({ status: 'no-voice' as const })) })
    await expect(call('speech:synthesize', { text: 'Bonjour', language: 'fr' })).resolves.toEqual({ status: 'no-voice' })
  })
})
