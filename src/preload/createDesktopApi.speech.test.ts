import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './createDesktopApi'

describe('desktop speech API', () => {
  it('sends only text and language, and returns a clean result', async () => {
    const invoke = vi.fn(async (channel: string) => (
      channel === 'speech:synthesize'
        ? { status: 'ok', wavBytes: new Uint8Array([1, 2]), voiceName: 'Microsoft David', extra: 'x' }
        : [{ name: 'Microsoft David', language: 'en-US', id: 'secret' }, { name: '' }]
    ))
    const api = createDesktopApi(invoke)

    await expect(api.speech.listVoices()).resolves.toEqual([{ name: 'Microsoft David', language: 'en-US' }])
    await expect(api.speech.synthesize({ text: 'Hi', language: 'en' })).resolves.toEqual({
      status: 'ok', wavBytes: new Uint8Array([1, 2]), voiceName: 'Microsoft David',
    })
    expect(invoke).toHaveBeenLastCalledWith('speech:synthesize', { text: 'Hi', language: 'en' })
  })

  it('treats anything unexpected as unsupported', async () => {
    const api = createDesktopApi(vi.fn(async () => ({ status: 'ok' })))
    await expect(api.speech.synthesize({ text: 'Hi', language: 'en' })).resolves.toEqual({ status: 'unsupported' })
    const noVoice = createDesktopApi(vi.fn(async () => ({ status: 'no-voice' })))
    await expect(noVoice.speech.synthesize({ text: 'Salut', language: 'fr' })).resolves.toEqual({ status: 'no-voice' })
  })
})
