import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoryMediaPublicItem } from '../../../shared/desktopApi'
import { STORY_FIELDS, STORY_LANGUAGES, type StoryFieldKey, type StoryLanguage } from '../../../shared/story'
import type { StoryPublicAnswer, StoryPublicState, StoryVersionSummary } from '../../../shared/storyPublic'
import type { StoryClient } from '../../services/story/StoryClient'
import { MyStory } from './MyStory'
import type { StoryVoiceRecorderLike } from './StoryVoiceRecorder'

function answer(
  fieldKey: StoryFieldKey,
  value: string,
  options: Partial<Pick<StoryPublicAnswer, 'confirmed' | 'indexStatus' | 'language'>> = {},
): StoryPublicAnswer {
  const field = STORY_FIELDS.find((item) => item.key === fieldKey)!
  return {
    fieldKey,
    section: field.section,
    label: field.label,
    question: field.prompt,
    answer: value,
    language: options.language ?? 'en',
    confirmed: options.confirmed ?? false,
    indexStatus: options.indexStatus ?? 'not_indexed',
    updatedAt: 10,
    confirmedAt: options.confirmed ? 9 : null,
  }
}

function state(...answers: StoryPublicAnswer[]): StoryPublicState {
  return {
    schemaVersion: 1,
    answers,
    confirmedCount: answers.filter((item) => item.confirmed).length,
  }
}

function media(
  id: number,
  fieldKey: StoryFieldKey,
  mediaType: 'photo' | 'audio',
  fileName: string,
): StoryMediaPublicItem {
  return {
    id,
    fieldKey,
    mediaType,
    fileName,
    mimeType: mediaType === 'photo' ? 'image/jpeg' : 'audio/wav',
    sizeBytes: 1_024,
    createdAt: 1_000 + id,
  }
}

function client(initial: StoryPublicState) {
  let current = initial
  const storyClient: StoryClient = {
    get: vi.fn(async () => current),
    saveDraft: vi.fn(async (fieldKey: StoryFieldKey, value: string, language: StoryLanguage) => {
      const existing = current.answers.find((item) => item.fieldKey === fieldKey)
      const next = answer(fieldKey, value, { language, confirmed: false, indexStatus: 'not_indexed' })
      current = state(...current.answers.filter((item) => item.fieldKey !== fieldKey), { ...next, updatedAt: (existing?.updatedAt ?? 10) + 1 })
      return current
    }),
    confirmField: vi.fn(async (fieldKey: StoryFieldKey) => {
      current = state(...current.answers.map((item) => item.fieldKey === fieldKey
        ? { ...item, confirmed: true, indexStatus: 'ready' as const, confirmedAt: 20 }
        : item))
      return current
    }),
    retryIndexing: vi.fn(async (fieldKey: StoryFieldKey) => {
      current = state(...current.answers.map((item) => item.fieldKey === fieldKey
        ? { ...item, indexStatus: 'ready' as const }
        : item))
      return current
    }),
    saveNow: vi.fn(async () => current),
    getHistory: vi.fn(async () => []),
    restoreVersion: vi.fn(async () => current),
    chooseAndAddMedia: vi.fn(async () => ({ canceled: true, items: [] })),
    listMedia: vi.fn(async () => []),
    openMedia: vi.fn(async () => ({ success: true as const })),
    deleteMedia: vi.fn(async () => ({ success: true as const })),
    transcribeRecording: vi.fn(async () => ({ transcript: '' })),
    getVoiceStatus: vi.fn(async () => ({ state: 'not_installed' as const, ready: false, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null })),
    startVoiceSetup: vi.fn(async () => ({ state: 'not_installed' as const, ready: false, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null })),
    pauseVoiceSetup: vi.fn(async () => ({ state: 'paused' as const, ready: false, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null })),
    repairVoiceSetup: vi.fn(async () => ({ state: 'not_installed' as const, ready: false, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null })),
    onVoiceSetupProgress: vi.fn(() => () => undefined),
  }
  return storyClient
}

function recorder(overrides: Partial<StoryVoiceRecorderLike> = {}): StoryVoiceRecorderLike {
  let recording = false
  return {
    start: vi.fn(async () => { recording = true }),
    stop: vi.fn(async () => { recording = false; return new Uint8Array([82, 73, 70, 70]) }),
    cancel: vi.fn(async () => { recording = false }),
    isRecording: vi.fn(() => recording),
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MyStory', () => {
  it('renders the fixed 16-memory/six-chapter schema with Guided as the default and confirmed-only progress', async () => {
    const storyClient = client(state(
      answer('fullName', 'Trevor Kasule', { confirmed: true, indexStatus: 'ready' }),
      answer('preferredName', 'Trevor'),
    ))
    render(<MyStory client={storyClient} />)

    expect(await screen.findByText('1 of 16 memories confirmed')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My Story' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guided' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Full name' })).toBeInTheDocument()
    expect(screen.getByText('What is your full name, and is there a story behind it?')).toBeInTheDocument()
    expect(screen.getByText('Confirmed — available to your private local AI.')).toBeInTheDocument()

    const language = screen.getByRole('combobox', { name: 'Language for this memory' })
    expect(within(language).getAllByRole('option')).toHaveLength(STORY_LANGUAGES.length)
    expect(screen.getByRole('button', { name: 'Who gave you that name?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Does it have a meaning or family story?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Go to Life Story chapter' }))
    expect(screen.getByRole('heading', { name: 'My story in a few words' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Chapters' }))
    expect(screen.getByRole('button', { name: 'Chapters' })).toHaveAttribute('aria-pressed', 'true')
    for (const section of ['Identity', 'Everyday Life', 'Life Story', 'People & Places', 'Values & Wishes', 'Care & Future']) {
      expect(screen.getByRole('heading', { name: section })).toBeInTheDocument()
    }
    expect(screen.getAllByTestId('story-field-editor')).toHaveLength(16)
  })

  it('debounces ordinary draft saves for 600 ms', async () => {
    const storyClient = client(state(answer('fullName', 'Trevor')))
    render(<MyStory client={storyClient} />)
    const input = await screen.findByRole('textbox', { name: 'Full name' })
    vi.useFakeTimers()

    fireEvent.change(input, { target: { value: 'Trevor K' } })
    expect(storyClient.saveDraft).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(599) })
    expect(storyClient.saveDraft).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve() })
    expect(storyClient.saveDraft).toHaveBeenCalledTimes(1)
    expect(storyClient.saveDraft).toHaveBeenCalledWith('fullName', 'Trevor K', 'en')
  })

  it('invalidates a confirmed memory immediately on its first edit, then debounces later edits', async () => {
    const storyClient = client(state(answer('fullName', 'Trevor', { confirmed: true, indexStatus: 'ready' })))
    render(<MyStory client={storyClient} />)
    const input = await screen.findByRole('textbox', { name: 'Full name' })
    vi.useFakeTimers()

    fireEvent.change(input, { target: { value: 'Trevor K' } })
    await act(async () => { await Promise.resolve() })
    expect(storyClient.saveDraft).toHaveBeenCalledTimes(1)
    expect(storyClient.saveDraft).toHaveBeenLastCalledWith('fullName', 'Trevor K', 'en')
    expect(screen.getByText('Draft — review your words before making this memory searchable.')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'Trevor Kasule' } })
    expect(storyClient.saveDraft).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(600); await Promise.resolve() })
    expect(storyClient.saveDraft).toHaveBeenCalledTimes(2)
    expect(storyClient.saveDraft).toHaveBeenLastCalledWith('fullName', 'Trevor Kasule', 'en')
  })

  it('confirms memories explicitly and offers retry when local indexing fails', async () => {
    const initial = state(answer('fullName', 'Trevor'))
    const storyClient = client(initial)
    vi.mocked(storyClient.confirmField).mockImplementationOnce(async () => state(
      answer('fullName', 'Trevor', { confirmed: true, indexStatus: 'failed' }),
    ))
    vi.mocked(storyClient.retryIndexing).mockImplementationOnce(async () => state(
      answer('fullName', 'Trevor', { confirmed: true, indexStatus: 'ready' }),
    ))
    render(<MyStory client={storyClient} />)

    await screen.findByRole('textbox', { name: 'Full name' })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm memory' }))
    expect(await screen.findByRole('button', { name: 'Retry private AI indexing' })).toBeInTheDocument()
    expect(storyClient.confirmField).toHaveBeenCalledWith('fullName')

    fireEvent.click(screen.getByRole('button', { name: 'Retry private AI indexing' }))
    await waitFor(() => expect(screen.getByText('Confirmed — available to your private local AI.')).toBeInTheDocument())
    expect(storyClient.retryIndexing).toHaveBeenCalledWith('fullName')
  })

  it('shows saving/saved state, supports Save now, and never exposes a raw persistence error', async () => {
    const storyClient = client(state(answer('fullName', 'Trevor')))
    vi.mocked(storyClient.saveDraft).mockRejectedValueOnce(new Error('C:\\private\\family.db SQLITE_BUSY'))
    render(<MyStory client={storyClient} />)
    const input = await screen.findByRole('textbox', { name: 'Full name' })
    vi.useFakeTimers()

    fireEvent.change(input, { target: { value: 'Changed' } })
    expect(screen.getByText('Saving…')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(600); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByText('Not saved yet — retry')).toBeInTheDocument()
    expect(screen.queryByText(/family\.db|SQLITE_BUSY/i)).toBeNull()

    vi.useRealTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Save now' }))
    await waitFor(() => expect(storyClient.saveNow).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Saved privately on this computer')).toBeInTheDocument()
  })

  it('offers all four modes and Review filters exact populated memories then jumps Edit back to Guided', async () => {
    const storyClient = client(state(
      answer('fullName', 'Trevor Kasule', { confirmed: true, indexStatus: 'ready' }),
      answer('childhood', 'Under the old mango tree'),
    ))
    render(<MyStory client={storyClient} />)
    await screen.findByText('1 of 16 memories confirmed')

    for (const mode of ['Guided', 'Chapters', 'Review', 'History']) {
      expect(screen.getByRole('button', { name: mode })).toHaveAttribute('aria-pressed', mode === 'Guided' ? 'true' : 'false')
    }

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByRole('button', { name: 'Review' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Trevor Kasule')).toBeInTheDocument()
    expect(screen.getByText('Under the old mango tree')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter memories' }), { target: { value: 'mango' } })
    expect(screen.queryByText('Trevor Kasule')).toBeNull()
    expect(screen.getByText('Under the old mango tree')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Childhood and early memories' }))
    expect(screen.getByRole('button', { name: 'Guided' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Childhood and early memories' })).toBeInTheDocument()
  })

  it('shows History newest-first and requires restore confirmation with focus return', async () => {
    const storyClient = client(state(answer('fullName', 'Current story', { confirmed: true, indexStatus: 'ready' })))
    const versions: StoryVersionSummary[] = [
      { versionId: 1, createdAt: 1_000, confirmedCount: 1 },
      { versionId: 2, createdAt: 2_000, confirmedCount: 3 },
    ]
    vi.mocked(storyClient.getHistory).mockResolvedValue(versions)
    vi.mocked(storyClient.restoreVersion).mockResolvedValue(state(
      answer('fullName', 'Restored story', { confirmed: true, indexStatus: 'pending' }),
    ))
    render(<MyStory client={storyClient} />)
    await screen.findByText('1 of 16 memories confirmed')

    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    const restoreButtons = await screen.findAllByRole('button', { name: /Restore version/ })
    expect(restoreButtons).toHaveLength(2)
    expect(restoreButtons[0]).toHaveAccessibleName('Restore version 2')
    expect(restoreButtons[1]).toHaveAccessibleName('Restore version 1')

    restoreButtons[0].focus()
    fireEvent.click(restoreButtons[0])
    expect(screen.getByRole('dialog', { name: 'Restore this Story version?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(storyClient.restoreVersion).not.toHaveBeenCalled()
    await waitFor(() => expect(restoreButtons[0]).toHaveFocus())

    fireEvent.click(restoreButtons[0])
    fireEvent.click(screen.getByRole('button', { name: 'Restore version' }))
    await waitFor(() => expect(storyClient.restoreVersion).toHaveBeenCalledWith(2))
    expect(screen.queryByRole('dialog', { name: 'Restore this Story version?' })).toBeNull()
    expect(screen.getByText('1 of 16 memories confirmed')).toBeInTheDocument()
  })

  it('uses ID-only private media controls for the active memory', async () => {
    const storyClient = client(state(answer('fullName', 'Trevor')))
    const portrait = media(41, 'fullName', 'photo', 'portrait.jpg')
    vi.mocked(storyClient.listMedia).mockResolvedValue([portrait])
    vi.mocked(storyClient.chooseAndAddMedia).mockResolvedValue({
      canceled: false,
      items: [media(42, 'fullName', 'audio', 'voice.wav')],
    })
    render(<MyStory client={storyClient} />)

    await screen.findByRole('textbox', { name: 'Full name' })
    expect(await screen.findByText('portrait.jpg')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open portrait.jpg' }))
    await waitFor(() => expect(storyClient.openMedia).toHaveBeenCalledWith(41))

    fireEvent.click(screen.getByRole('button', { name: 'Add photo' }))
    await waitFor(() => expect(storyClient.chooseAndAddMedia).toHaveBeenCalledWith('fullName', 'photo'))

    fireEvent.click(screen.getByRole('button', { name: 'Add audio' }))
    await waitFor(() => expect(storyClient.chooseAndAddMedia).toHaveBeenCalledWith('fullName', 'audio'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete portrait.jpg' }))
    await waitFor(() => expect(storyClient.deleteMedia).toHaveBeenCalledWith(41))
    expect(screen.queryByText('portrait.jpg')).toBeNull()
  })

  it('shows a safe microphone-permission error without leaking browser details', async () => {
    const storyClient = client(state(answer('fullName', '')))
    const voiceRecorder = recorder({
      start: vi.fn(async () => { throw new Error('NotAllowedError deviceId=secret-mic') }),
    })
    render(<MyStory client={storyClient} createVoiceRecorder={() => voiceRecorder} />)

    await screen.findByRole('textbox', { name: 'Full name' })
    fireEvent.click(screen.getByRole('button', { name: 'Record voice' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone access was not available. Check your permission and try again.')
    expect(screen.queryByText(/NotAllowedError|deviceId=secret-mic/)).toBeNull()
  })

  it('records, transcribes, and inserts transcript text as an unconfirmed draft', async () => {
    const storyClient = client(state(answer('fullName', '')))
    const voiceRecorder = recorder()
    let resolveTranscript!: (value: { transcript: string }) => void
    vi.mocked(storyClient.transcribeRecording).mockImplementationOnce(() => new Promise((resolve) => {
      resolveTranscript = resolve
    }))
    render(<MyStory client={storyClient} createVoiceRecorder={() => voiceRecorder} />)

    const input = await screen.findByRole('textbox', { name: 'Full name' })
    fireEvent.click(screen.getByRole('button', { name: 'Record voice' }))
    await waitFor(() => expect(voiceRecorder.start).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Recording…')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(await screen.findByText('Transcribing…')).toBeInTheDocument()
    expect(storyClient.transcribeRecording).toHaveBeenCalledWith(expect.any(Uint8Array), 'en')

    await act(async () => { resolveTranscript({ transcript: 'Spoken family memory' }); await Promise.resolve() })
    await waitFor(() => expect(input).toHaveValue('Spoken family memory'))
    expect(storyClient.saveDraft).toHaveBeenCalledWith('fullName', 'Spoken family memory', 'en')
    expect(storyClient.confirmField).not.toHaveBeenCalled()
    expect(screen.getByText('Transcript added as draft')).toBeInTheDocument()
    expect(screen.getByText('Draft — review your words before making this memory searchable.')).toBeInTheDocument()
  })

  it('shows a safe transcription error and keeps the memory unconfirmed', async () => {
    const storyClient = client(state(answer('fullName', '')))
    const voiceRecorder = recorder()
    vi.mocked(storyClient.transcribeRecording).mockRejectedValueOnce(new Error('C:\\models\\whisper.exe temp.wav stderr'))
    render(<MyStory client={storyClient} createVoiceRecorder={() => voiceRecorder} />)

    await screen.findByRole('textbox', { name: 'Full name' })
    fireEvent.click(screen.getByRole('button', { name: 'Record voice' }))
    await waitFor(() => expect(voiceRecorder.start).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Voice transcription failed. Try again.')
    expect(screen.queryByText(/whisper\.exe|temp\.wav|stderr/i)).toBeNull()
    expect(storyClient.confirmField).not.toHaveBeenCalled()
  })
})
