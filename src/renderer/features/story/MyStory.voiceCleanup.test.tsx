import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StoryPublicState } from '../../../shared/storyPublic'
import type { StoryClient } from '../../services/story/StoryClient'
import { MyStory } from './MyStory'
import type { StoryVoiceRecorderLike } from './StoryVoiceRecorder'

const emptyStory: StoryPublicState = { schemaVersion: 1, answers: [], confirmedCount: 0 }

function client(): StoryClient {
  const status = { state: 'not_installed' as const, ready: false, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null }
  return {
    get: vi.fn(async () => emptyStory),
    saveDraft: vi.fn(async () => emptyStory),
    confirmField: vi.fn(async () => emptyStory),
    retryIndexing: vi.fn(async () => emptyStory),
    saveNow: vi.fn(async () => emptyStory),
    getHistory: vi.fn(async () => []),
    restoreVersion: vi.fn(async () => emptyStory),
    chooseAndAddMedia: vi.fn(async () => ({ canceled: true, items: [] })),
    listMedia: vi.fn(async () => []),
    openMedia: vi.fn(async () => ({ success: true as const })),
    deleteMedia: vi.fn(async () => ({ success: true as const })),
    transcribeRecording: vi.fn(async () => ({ transcript: '' })),
    getVoiceStatus: vi.fn(async () => status),
    startVoiceSetup: vi.fn(async () => status),
    pauseVoiceSetup: vi.fn(async () => ({ ...status, state: 'paused' as const })),
    repairVoiceSetup: vi.fn(async () => status),
    onVoiceSetupProgress: vi.fn(() => () => undefined),
  }
}

describe('MyStory voice cleanup', () => {
  it('cancels an active microphone recorder when the Story screen unmounts', async () => {
    let recording = false
    const recorder: StoryVoiceRecorderLike = {
      start: vi.fn(async () => { recording = true }),
      stop: vi.fn(async () => { recording = false; return new Uint8Array([82, 73, 70, 70]) }),
      cancel: vi.fn(async () => { recording = false }),
      isRecording: vi.fn(() => recording),
    }

    const view = render(<MyStory client={client()} createVoiceRecorder={() => recorder} />)
    await screen.findByText('0 of 16 memories confirmed')
    fireEvent.click(screen.getByRole('button', { name: 'Record voice' }))
    await waitFor(() => expect(recorder.start).toHaveBeenCalledTimes(1))

    view.unmount()

    await waitFor(() => expect(recorder.cancel).toHaveBeenCalledTimes(1))
  })
})
