import { describe, expect, it, vi } from 'vitest'
import { DesktopStoryClient } from './DesktopStoryClient'

describe('DesktopStoryClient', () => {
  it('adapts renderer-friendly calls to the narrow desktop Story API', async () => {
    const operations = {
      get: vi.fn(async () => ({ schemaVersion: 1 as const, answers: [], confirmedCount: 0 })),
      saveDraft: vi.fn(async () => ({ schemaVersion: 1 as const, answers: [], confirmedCount: 0 })),
      confirmField: vi.fn(async () => ({ schemaVersion: 1 as const, answers: [], confirmedCount: 0 })),
      retryIndexing: vi.fn(async () => ({ schemaVersion: 1 as const, answers: [], confirmedCount: 0 })),
      saveNow: vi.fn(async () => ({ schemaVersion: 1 as const, answers: [], confirmedCount: 0 })),
      getHistory: vi.fn(async () => []),
      restoreVersion: vi.fn(async () => ({ schemaVersion: 1 as const, answers: [], confirmedCount: 0 })),
      chooseAndAddMedia: vi.fn(async () => ({ canceled: false, items: [] })),
      listMedia: vi.fn(async () => []),
      openMedia: vi.fn(async () => ({ success: true as const })),
      deleteMedia: vi.fn(async () => ({ success: true as const })),
      transcribeRecording: vi.fn(async () => ({ transcript: 'Memory' })),
      getVoiceStatus: vi.fn(async () => ({ state: 'ready' as const, ready: true, repairRequired: false, totalSizeBytes: 400, version: 'voice-v1', message: 'Ready' })),
      startVoiceSetup: vi.fn(async () => ({ state: 'ready' as const, ready: true, repairRequired: false, totalSizeBytes: 400, version: 'voice-v1', message: 'Ready' })),
      pauseVoiceSetup: vi.fn(async () => ({ state: 'paused' as const, ready: false, repairRequired: false, totalSizeBytes: 400, version: 'voice-v1', message: 'Paused' })),
      repairVoiceSetup: vi.fn(async () => ({ state: 'ready' as const, ready: true, repairRequired: false, totalSizeBytes: 400, version: 'voice-v1', message: 'Ready' })),
      onVoiceSetupProgress: vi.fn(() => () => undefined),
    }
    const client = new DesktopStoryClient(operations)
    const wav = new Uint8Array([1, 2, 3])
    const listener = vi.fn()

    await client.get()
    await client.saveDraft('fullName', 'Trevor', 'en')
    await client.confirmField('fullName')
    await client.retryIndexing('fullName')
    await client.saveNow()
    await client.getHistory()
    await client.restoreVersion(4)
    await client.chooseAndAddMedia('fullName', 'photo')
    await client.listMedia()
    await client.openMedia(3)
    await client.deleteMedia(3)
    await client.transcribeRecording(wav, 'en')
    await client.getVoiceStatus()
    await client.startVoiceSetup()
    await client.pauseVoiceSetup()
    await client.repairVoiceSetup()
    client.onVoiceSetupProgress(listener)

    expect(operations.saveDraft).toHaveBeenCalledWith({ fieldKey: 'fullName', answer: 'Trevor', language: 'en' })
    expect(operations.confirmField).toHaveBeenCalledWith({ fieldKey: 'fullName' })
    expect(operations.retryIndexing).toHaveBeenCalledWith({ fieldKey: 'fullName' })
    expect(operations.restoreVersion).toHaveBeenCalledWith({ versionId: 4 })
    expect(operations.chooseAndAddMedia).toHaveBeenCalledWith({ fieldKey: 'fullName', mediaType: 'photo' })
    expect(operations.openMedia).toHaveBeenCalledWith({ mediaId: 3 })
    expect(operations.deleteMedia).toHaveBeenCalledWith({ mediaId: 3 })
    expect(operations.transcribeRecording).toHaveBeenCalledWith({ wavBytes: wav, language: 'en' })
    expect(operations.onVoiceSetupProgress).toHaveBeenCalledWith(listener)
  })
})
