import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORY_FIELDS, STORY_LANGUAGES, type StoryFieldKey, type StoryLanguage } from '../../../shared/story'
import type { StoryPublicAnswer, StoryPublicState } from '../../../shared/storyPublic'
import type { StoryClient } from '../../services/story/StoryClient'
import { MyStory } from './MyStory'

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
    getVoiceStatus: vi.fn(async () => ({ state: 'not_installed', ready: false, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null })),
    startVoiceSetup: vi.fn(async () => ({ state: 'not_installed', ready: false, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null })),
    pauseVoiceSetup: vi.fn(async () => ({ state: 'paused', ready: false, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null })),
    repairVoiceSetup: vi.fn(async () => ({ state: 'not_installed', ready: false, repairRequired: false, totalSizeBytes: 0, version: 'voice-v1', message: null })),
    onVoiceSetupProgress: vi.fn(() => () => undefined),
  }
  return storyClient
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

    expect(await screen.findByRole('heading', { name: 'My Story' })).toBeInTheDocument()
    expect(screen.getByText('1 of 16 memories confirmed')).toBeInTheDocument()
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
})
