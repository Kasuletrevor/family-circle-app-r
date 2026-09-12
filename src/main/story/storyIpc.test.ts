import { describe, expect, it, vi } from 'vitest'
import { MAX_VOICE_WAV_BYTES } from '../voice/VoiceTranscriptionService'
import { registerStoryIpc } from './storyIpc'

type Handler = (event: unknown, payload?: unknown) => unknown

function createRegistrar() {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    ipc: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener)
      },
    },
  }
}

const storyState = {
  schemaVersion: 1 as const,
  answers: [{
    fieldKey: 'fullName' as const,
    section: 'Identity' as const,
    label: 'Full name',
    question: 'What is your full name?',
    answer: 'Trevor',
    language: 'en' as const,
    confirmed: true,
    indexStatus: 'ready' as const,
    updatedAt: 10,
    confirmedAt: 9,
    localUserId: 77,
    embedding: [1, 2, 3],
    storedRelativePath: 'secret/path',
  }],
  confirmedCount: 1,
  localUserId: 77,
}

function dependencies() {
  return {
    story: {
      get: vi.fn(async () => storyState as never),
      saveDraft: vi.fn(async () => storyState as never),
      confirmField: vi.fn(async () => storyState as never),
      retryIndexing: vi.fn(async () => storyState as never),
      saveNow: vi.fn(async () => storyState as never),
      getHistory: vi.fn(async () => [{ versionId: 4, createdAt: 123, confirmedCount: 1, localUserId: 77 }] as never),
      restoreVersion: vi.fn(async () => storyState as never),
    },
    media: {
      chooseAndAdd: vi.fn(async () => ({
        canceled: false,
        items: [{
          id: 3,
          fieldKey: 'fullName',
          mediaType: 'photo',
          fileName: 'family.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 321,
          createdAt: 45,
          storedRelativePath: 'story/users/77/media/secret.jpg',
          localUserId: 77,
        }],
      }) as never),
      list: vi.fn(async () => [{
        id: 3,
        fieldKey: 'fullName',
        mediaType: 'photo',
        fileName: 'family.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 321,
        createdAt: 45,
        storedRelativePath: 'story/users/77/media/secret.jpg',
        localUserId: 77,
      }] as never),
      open: vi.fn(async () => ({ success: true as const })),
      delete: vi.fn(async () => ({ success: true as const })),
    },
    voiceAssets: {
      getStatus: vi.fn(async () => ({
        state: 'ready', phase: 'ready', percent: 100, fileIndex: 0, fileCount: 0, fileName: null,
        bytesDownloaded: 155_933_566, totalBytes: 155_933_566, fileBytesDownloaded: 0, fileSizeBytes: 0,
        message: 'Offline voice is ready', executable: 'C:/secret/whisper-cli.exe', model: 'C:/secret/model.bin',
      }) as never),
      startSetup: vi.fn(async (onProgress?: (progress: unknown) => void) => {
        onProgress?.({
          state: 'downloading', phase: 'downloading', percent: 25, fileIndex: 1, fileCount: 2,
          fileName: 'Whisper runtime', bytesDownloaded: 100, totalBytes: 400, fileBytesDownloaded: 100,
          fileSizeBytes: 200, message: 'Downloading offline voice', targetPath: 'C:/secret', sha256: 'SECRET',
        })
        return {
          state: 'ready', phase: 'ready', percent: 100, fileIndex: 0, fileCount: 0, fileName: null,
          bytesDownloaded: 400, totalBytes: 400, fileBytesDownloaded: 0, fileSizeBytes: 0,
          message: 'Offline voice is ready',
        } as never
      }),
      pauseSetup: vi.fn(() => ({
        state: 'paused', phase: 'paused', percent: 25, fileIndex: 1, fileCount: 2, fileName: 'Whisper runtime',
        bytesDownloaded: 100, totalBytes: 400, fileBytesDownloaded: 100, fileSizeBytes: 200,
        message: 'Offline voice setup paused', runtimeDir: 'C:/secret',
      }) as never),
      repair: vi.fn(async (onProgress?: (progress: unknown) => void) => {
        onProgress?.({ state: 'verifying', phase: 'verifying', percent: 90, fileIndex: 2, fileCount: 2, fileName: 'Whisper base model', bytesDownloaded: 390, totalBytes: 400, fileBytesDownloaded: 190, fileSizeBytes: 200, message: 'Verifying offline voice', url: 'https://secret.example/model' })
        return { state: 'ready', phase: 'ready', percent: 100, fileIndex: 0, fileCount: 0, fileName: null, bytesDownloaded: 400, totalBytes: 400, fileBytesDownloaded: 0, fileSizeBytes: 0, message: 'Offline voice is ready' } as never
      }),
    },
    transcription: {
      transcribe: vi.fn(async () => ({ transcript: 'A private memory', modelPath: 'C:/secret/model.bin', stderr: 'secret' }) as never),
    },
  }
}

function handler(handlers: Map<string, Handler>, channel: string): Handler {
  const value = handlers.get(channel)
  expect(value, `missing ${channel}`).toBeTypeOf('function')
  return value!
}

describe('Story IPC boundary', () => {
  it('reconstructs mutation inputs field-by-field and never trusts renderer identity, paths, or model flags', async () => {
    const { ipc, handlers } = createRegistrar()
    const deps = dependencies()
    registerStoryIpc(ipc, deps)

    await handler(handlers, 'story:save-draft')({}, {
      fieldKey: 'fullName', answer: 'Trevor', language: 'en', localUserId: 999, ownerId: 999,
      storedRelativePath: 'C:/escape', executable: 'cmd.exe', model: 'evil.bin', flags: ['--evil'],
    })
    expect(deps.story.saveDraft).toHaveBeenCalledWith({ fieldKey: 'fullName', answer: 'Trevor', language: 'en' })

    await handler(handlers, 'story:confirm-field')({}, { fieldKey: 'fullName', localUserId: 999 })
    await handler(handlers, 'story:retry-indexing')({}, { fieldKey: 'fullName', embedding: [9] })
    await handler(handlers, 'story:restore-version')({}, { versionId: 4, localUserId: 999 })
    await handler(handlers, 'story:choose-add-media')({}, { fieldKey: 'fullName', mediaType: 'photo', path: 'C:/secret.jpg' })
    await handler(handlers, 'story:open-media')({}, { mediaId: 3, path: 'C:/secret.jpg' })
    await handler(handlers, 'story:delete-media')({}, { mediaId: 3, localUserId: 999 })

    expect(deps.story.confirmField).toHaveBeenCalledWith({ fieldKey: 'fullName' })
    expect(deps.story.retryIndexing).toHaveBeenCalledWith({ fieldKey: 'fullName' })
    expect(deps.story.restoreVersion).toHaveBeenCalledWith({ versionId: 4 })
    expect(deps.media.chooseAndAdd).toHaveBeenCalledWith({ fieldKey: 'fullName', mediaType: 'photo' })
    expect(deps.media.open).toHaveBeenCalledWith({ mediaId: 3 })
    expect(deps.media.delete).toHaveBeenCalledWith({ mediaId: 3 })
  })

  it('sanitizes Story, history, media, transcription, voice status, and progress outputs', async () => {
    const { ipc, handlers } = createRegistrar()
    const deps = dependencies()
    registerStoryIpc(ipc, deps)

    const story = await handler(handlers, 'story:get')({})
    const history = await handler(handlers, 'story:get-history')({})
    const media = await handler(handlers, 'story:list-media')({})
    const transcript = await handler(handlers, 'story:transcribe-recording')({}, { wavBytes: new Uint8Array(44), language: 'en' })
    const status = await handler(handlers, 'story:voice-status')({})
    const sent: Array<{ channel: string; payload: unknown }> = []
    const started = await handler(handlers, 'story:voice-start-setup')({ sender: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } })

    for (const value of [story, history, media, transcript, status, started, ...sent.map((item) => item.payload)]) {
      expect(JSON.stringify(value)).not.toMatch(/localUserId|storedRelativePath|embedding|executable|modelPath|runtimeDir|targetPath|sha256|stderr|secret/i)
    }
    expect(transcript).toEqual({ transcript: 'A private memory' })
    expect(status).toEqual({
      state: 'ready', ready: true, repairRequired: false, totalSizeBytes: 155_933_566,
      version: 'whisper-v1.9.1-base-v1', message: 'Offline voice is ready',
    })
    expect(sent).toEqual([{ channel: 'story:voice-setup-progress', payload: {
      state: 'downloading', percent: 25, fileIndex: 1, fileCount: 2, fileName: 'Whisper runtime',
      bytesDownloaded: 100, totalSizeBytes: 400, fileBytesDownloaded: 100, fileSizeBytes: 200,
      message: 'Downloading offline voice',
    } }])
  })

  it('rejects oversized or malformed recording payloads before transcription dispatch', async () => {
    const { ipc, handlers } = createRegistrar()
    const deps = dependencies()
    registerStoryIpc(ipc, deps)

    await expect(handler(handlers, 'story:transcribe-recording')({}, {
      wavBytes: new Uint8Array(MAX_VOICE_WAV_BYTES + 1), language: 'en', executable: 'cmd.exe',
    })).rejects.toThrow('Voice recording is invalid')
    await expect(handler(handlers, 'story:transcribe-recording')({}, {
      wavBytes: 'not-bytes', language: 'en',
    })).rejects.toThrow('Voice recording is invalid')
    expect(deps.transcription.transcribe).not.toHaveBeenCalled()
  })
})
