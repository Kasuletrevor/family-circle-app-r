import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './createDesktopApi'

describe('createDesktopApi Story contract', () => {
  it('exposes only the approved Story surface and strips untrusted mutation fields', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'story:get') {
        return {
          schemaVersion: 1,
          answers: [{
            fieldKey: 'fullName', section: 'Identity', label: 'Full name', question: 'Question', answer: 'Trevor',
            language: 'en', confirmed: true, indexStatus: 'ready', updatedAt: 10, confirmedAt: 9,
            localUserId: 77, storedRelativePath: 'secret', embedding: [1, 2],
          }],
          confirmedCount: 1,
          localUserId: 77,
        }
      }
      if (channel === 'story:list-media') {
        return [{ id: 3, fieldKey: 'fullName', mediaType: 'photo', fileName: 'family.jpg', mimeType: 'image/jpeg', sizeBytes: 123, createdAt: 10, storedRelativePath: 'secret', localUserId: 77 }]
      }
      if (channel === 'story:voice-status') {
        return { state: 'ready', ready: true, repairRequired: false, totalSizeBytes: 400, version: 'voice-v1', message: 'Offline voice is ready', executable: 'C:/secret.exe', modelPath: 'C:/secret.bin' }
      }
      if (channel === 'story:transcribe-recording') {
        return { transcript: 'Private memory', stderr: 'secret', modelPath: 'C:/secret.bin' }
      }
      return { success: true }
    })

    const api = createDesktopApi(invoke)
    expect(Object.keys(api.story)).toEqual([
      'get', 'saveDraft', 'confirmField', 'retryIndexing', 'saveNow', 'getHistory', 'restoreVersion',
      'chooseAndAddMedia', 'listMedia', 'openMedia', 'deleteMedia', 'transcribeRecording',
      'getVoiceStatus', 'startVoiceSetup', 'pauseVoiceSetup', 'repairVoiceSetup', 'onVoiceSetupProgress',
    ])

    await api.story.saveDraft({
      fieldKey: 'fullName', answer: 'Trevor', language: 'en', localUserId: 999, path: 'C:/escape', model: 'evil.bin',
    } as never)
    await api.story.confirmField({ fieldKey: 'fullName', ownerId: 999 } as never)
    await api.story.restoreVersion({ versionId: 4, localUserId: 999 } as never)
    await api.story.chooseAndAddMedia({ fieldKey: 'fullName', mediaType: 'photo', path: 'C:/escape.jpg' } as never)
    await api.story.openMedia({ mediaId: 3, storedRelativePath: 'secret' } as never)
    await api.story.deleteMedia({ mediaId: 3, localUserId: 999 } as never)
    await api.story.transcribeRecording({ wavBytes: new Uint8Array([1, 2, 3]), language: 'en', executable: 'cmd.exe', flags: ['--evil'] } as never)

    expect(invoke).toHaveBeenCalledWith('story:save-draft', { fieldKey: 'fullName', answer: 'Trevor', language: 'en' })
    expect(invoke).toHaveBeenCalledWith('story:confirm-field', { fieldKey: 'fullName' })
    expect(invoke).toHaveBeenCalledWith('story:restore-version', { versionId: 4 })
    expect(invoke).toHaveBeenCalledWith('story:choose-add-media', { fieldKey: 'fullName', mediaType: 'photo' })
    expect(invoke).toHaveBeenCalledWith('story:open-media', { mediaId: 3 })
    expect(invoke).toHaveBeenCalledWith('story:delete-media', { mediaId: 3 })
    const transcribeCall = invoke.mock.calls.find(([channel]) => channel === 'story:transcribe-recording')
    expect(transcribeCall?.[1]).toEqual({ wavBytes: new Uint8Array([1, 2, 3]), language: 'en' })
  })

  it('sanitizes Story, media, transcript, and voice DTOs before exposing them to the renderer', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'story:get') return {
        schemaVersion: 1,
        answers: [{ fieldKey: 'fullName', section: 'Identity', label: 'Full name', question: 'Question', answer: 'Trevor', language: 'en', confirmed: true, indexStatus: 'ready', updatedAt: 10, confirmedAt: 9, localUserId: 77, embedding: [1] }],
        confirmedCount: 1,
        path: 'C:/secret',
      }
      if (channel === 'story:list-media') return [{ id: 3, fieldKey: 'fullName', mediaType: 'photo', fileName: 'family.jpg', mimeType: 'image/jpeg', sizeBytes: 123, createdAt: 10, storedRelativePath: 'secret' }]
      if (channel === 'story:transcribe-recording') return { transcript: 'Private memory', stderr: 'secret', modelPath: 'C:/secret.bin' }
      return { state: 'ready', ready: true, repairRequired: false, totalSizeBytes: 400, version: 'voice-v1', message: 'Ready', executable: 'secret.exe' }
    })
    const api = createDesktopApi(invoke)

    const values = [
      await api.story.get(),
      await api.story.listMedia(),
      await api.story.transcribeRecording({ wavBytes: new Uint8Array([1]), language: 'en' }),
      await api.story.getVoiceStatus(),
    ]
    for (const value of values) expect(JSON.stringify(value)).not.toMatch(/localUserId|storedRelativePath|embedding|modelPath|executable|stderr|path/i)
  })

  it('sanitizes voice setup progress and preserves unsubscribe semantics', () => {
    let bridgeListener: ((payload: unknown) => void) | null = null
    const unsubscribe = vi.fn()
    const subscribe = vi.fn((_channel: string, listener: (payload: unknown) => void) => {
      bridgeListener = listener
      return unsubscribe
    })
    const api = createDesktopApi(vi.fn(async () => undefined), subscribe as never)
    const listener = vi.fn()

    expect(api.story.onVoiceSetupProgress(listener)).toBe(unsubscribe)
    expect(subscribe).toHaveBeenCalledWith('story:voice-setup-progress', expect.any(Function))
    ;(bridgeListener as ((payload: unknown) => void) | null)?.({
      state: 'downloading', percent: 25, fileIndex: 1, fileCount: 2, fileName: 'Whisper runtime',
      bytesDownloaded: 100, totalSizeBytes: 400, fileBytesDownloaded: 100, fileSizeBytes: 200,
      message: 'Downloading offline voice', targetPath: 'C:/secret', sha256: 'SECRET', modelPath: 'C:/secret.bin',
    })
    expect(listener).toHaveBeenCalledWith({
      state: 'downloading', percent: 25, fileIndex: 1, fileCount: 2, fileName: 'Whisper runtime',
      bytesDownloaded: 100, totalSizeBytes: 400, fileBytesDownloaded: 100, fileSizeBytes: 200,
      message: 'Downloading offline voice',
    })
  })
})
