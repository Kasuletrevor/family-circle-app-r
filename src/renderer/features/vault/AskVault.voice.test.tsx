import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoicePublicStatus } from '../../../shared/desktopApi'
import type { SpeechClient } from '../../services/speech/SpeechClient'
import type { StoryClient } from '../../services/story/StoryClient'
import type { VaultClient } from '../../services/vault/VaultClient'
import type { StoryVoiceRecorderLike } from '../story/StoryVoiceRecorder'
import { AskVault, type AudioPlayback } from './AskVault'

const readyVoice: VoicePublicStatus = { state: 'ready', ready: true, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null }
const missingVoice: VoicePublicStatus = { ...readyVoice, state: 'not_installed', ready: false }

function vaultClient(overrides: Partial<VaultClient> = {}): VaultClient {
  return {
    listDocuments: vi.fn(async () => []),
    chooseAndUploadDocuments: vi.fn(async () => ({ canceled: true, items: [] })),
    openDocument: vi.fn(async () => ({ success: true as const })),
    retryExtraction: vi.fn(),
    retryIndexing: vi.fn(async () => ({ success: true as const })),
    deleteDocument: vi.fn(async () => ({ success: true as const })),
    ask: vi.fn(async () => ({ answer: 'Elle est née à Masaka.', sources: [] })),
    onUploadProgress: vi.fn(() => () => undefined),
    ...overrides,
  }
}

function storyClient(overrides: Partial<StoryClient> = {}): StoryClient {
  return {
    transcribeRecording: vi.fn(async () => ({ transcript: 'Où est née grand-mère ?' })),
    getVoiceStatus: vi.fn(async () => readyVoice),
    startVoiceSetup: vi.fn(async () => ({ ...missingVoice, state: 'downloading' as const })),
    pauseVoiceSetup: vi.fn(async () => missingVoice),
    repairVoiceSetup: vi.fn(async () => missingVoice),
    onVoiceSetupProgress: vi.fn(() => () => undefined),
    ...overrides,
  } as unknown as StoryClient
}

function speechClient(overrides: Partial<SpeechClient> = {}): SpeechClient {
  return {
    listVoices: vi.fn(async () => []),
    synthesize: vi.fn(async () => ({ status: 'ok' as const, wavBytes: new Uint8Array([82, 73, 70, 70]), voiceName: 'Microsoft Hortense' })),
    ...overrides,
  }
}

function recorder(): StoryVoiceRecorderLike {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => new Uint8Array([1, 2, 3])),
    cancel: vi.fn(async () => undefined),
    isRecording: vi.fn(() => false),
  }
}

function playback() {
  const stop = vi.fn<() => void>()
  const result: AudioPlayback = { done: new Promise<void>(() => undefined), stop }
  return Object.assign(result, { stop })
}

afterEach(() => window.localStorage.clear())

describe('AskVault languages and voice', () => {
  it('asks in the chosen language and remembers it', async () => {
    const ask = vi.fn(async () => ({ answer: 'Elle est née à Masaka.', sources: [] }))
    const { unmount } = render(<AskVault client={vaultClient({ ask })} storyClient={storyClient()} speechClient={speechClient()} />)

    expect(screen.getByLabelText('Ask and answer in')).toHaveValue('en')
    fireEvent.change(screen.getByLabelText('Ask and answer in'), { target: { value: 'fr' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Où est-elle née ?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Private AI' }))

    await waitFor(() => expect(ask).toHaveBeenCalledWith('Où est-elle née ?', { type: 'story-and-vault' }, 'fr'))
    expect(await screen.findByText('Elle est née à Masaka.')).toBeInTheDocument()
    unmount()

    render(<AskVault client={vaultClient()} storyClient={storyClient()} speechClient={speechClient()} />)
    expect(screen.getByLabelText('Ask and answer in')).toHaveValue('fr')
  })

  it('records a spoken question, transcribes it offline in that language, and waits for review', async () => {
    const ask = vi.fn()
    const story = storyClient()
    const voiceRecorder = recorder()
    render(<AskVault client={vaultClient({ ask })} storyClient={story} speechClient={speechClient()} createVoiceRecorder={() => voiceRecorder} />)

    fireEvent.change(screen.getByLabelText('Ask and answer in'), { target: { value: 'fr' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask by voice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop and use question' }))
    expect(screen.queryByText(/Listening in French/)).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Où est née grand-mère ?'))
    expect(story.transcribeRecording).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'fr')
    expect(screen.getByText('Check your question, then press Ask Private AI.')).toBeInTheDocument()
    expect(ask).not.toHaveBeenCalled()
  })

  it('offers the one-time offline voice setup instead of recording when voice is not installed', async () => {
    const story = storyClient({ getVoiceStatus: vi.fn(async () => missingVoice) })
    const createVoiceRecorder = vi.fn(recorder)
    render(<AskVault client={vaultClient()} storyClient={story} speechClient={speechClient()} createVoiceRecorder={createVoiceRecorder} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ask by voice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Set up offline voice' }))

    await waitFor(() => expect(story.startVoiceSetup).toHaveBeenCalledTimes(1))
    expect(createVoiceRecorder).not.toHaveBeenCalled()
  })

  it('keeps Pause available while the offline voice download is running', async () => {
    const story = storyClient({
      getVoiceStatus: vi.fn(async () => missingVoice),
      startVoiceSetup: vi.fn(() => new Promise<VoicePublicStatus>(() => undefined)),
      onVoiceSetupProgress: vi.fn((listener) => {
        queueMicrotask(() => listener({
          state: 'downloading', percent: 10, fileIndex: 1, fileCount: 1, fileName: null,
          bytesDownloaded: 1, totalSizeBytes: 10, fileBytesDownloaded: 1, fileSizeBytes: 10, message: null,
        }))
        return () => undefined
      }),
    })
    render(<AskVault client={vaultClient()} storyClient={story} speechClient={speechClient()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ask by voice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Set up offline voice' }))
    const pause = await screen.findByRole('button', { name: 'Pause download' })
    expect(pause).toBeEnabled()
    fireEvent.click(pause)
    await waitFor(() => expect(story.pauseVoiceSetup).toHaveBeenCalledTimes(1))
  })

  it('reads the answer aloud in the answer language when enabled, and can stop', async () => {
    const speech = speechClient()
    const played = playback()
    const playAudio = vi.fn(() => played)
    render(<AskVault client={vaultClient()} storyClient={storyClient()} speechClient={speech} playAudio={playAudio} />)

    fireEvent.change(screen.getByLabelText('Ask and answer in'), { target: { value: 'fr' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read answers aloud' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Où ?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Private AI' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Stop reading' }))
    expect(speech.synthesize).toHaveBeenCalledWith('Elle est née à Masaka.', 'fr')
    expect(playAudio).toHaveBeenCalledWith(new Uint8Array([82, 73, 70, 70]))
    expect(played.stop).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument()
  })

  it('explains how to add a voice when none is installed for the language', async () => {
    const speech = speechClient({ synthesize: vi.fn(async () => ({ status: 'no-voice' as const })) })
    const playAudio = vi.fn(playback)
    render(<AskVault client={vaultClient()} storyClient={storyClient()} speechClient={speech} playAudio={playAudio} />)

    fireEvent.change(screen.getByLabelText('Ask and answer in'), { target: { value: 'fr' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Où ?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Private AI' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Listen' }))

    expect(await screen.findByText(/No French voice is installed on this computer/)).toBeInTheDocument()
    expect(playAudio).not.toHaveBeenCalled()
  })
})
