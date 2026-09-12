import { useEffect, useMemo, useRef, useState } from 'react'
import {
  STORY_FIELDS,
  STORY_LANGUAGES,
  type StoryFieldDefinition,
  type StoryFieldKey,
  type StoryLanguage,
  type StorySection,
} from '../../../shared/story'
import type { StoryPublicAnswer, StoryPublicState } from '../../../shared/storyPublic'
import { DesktopStoryClient } from '../../services/story/DesktopStoryClient'
import type { StoryClient } from '../../services/story/StoryClient'
import './MyStory.css'

const defaultClient = new DesktopStoryClient()
const SAVE_DELAY_MS = 600

const STORY_SECTIONS: readonly StorySection[] = [
  'Identity',
  'Everyday Life',
  'Life Story',
  'People & Places',
  'Values & Wishes',
  'Care & Future',
]

const FOLLOW_UPS: Partial<Record<StoryFieldKey, readonly string[]>> = {
  fullName: ['Who gave you that name?', 'Does it have a meaning or family story?'],
  preferredName: ['Who first called you that?', 'How does that name make you feel?'],
  roots: ['What do you remember most about that place?', 'Which family roots matter most to you?'],
  languages: ['Which language feels most like home?', 'Who taught you the languages you know?'],
  occupation: ['What part of your day matters most?', 'What would surprise your family about your work?'],
  lifeStage: ['Why does this moment feel right?', 'Who are you hoping will read this one day?'],
  snapshot: ['What are you proudest of?', 'What would you want a future grandchild to understand first?'],
  childhood: ['Who was there with you?', 'What sounds, smells, or places do you still remember?'],
  education: ['Who was an important teacher?', 'What lesson stayed with you outside the classroom?'],
  workLife: ['Who did you help along the way?', 'What contribution do you hope is remembered?'],
  relationships: ['What did this person teach you?', 'Is there a story that captures your bond?'],
  milestones: ['What changed after that moment?', 'Who shared that turning point with you?'],
  traditions: ['Who taught you this tradition?', 'How should the next generation keep it alive?'],
  values: ['When was this value tested?', 'Who helped shape this belief?'],
  carePreferences: ['What helps you feel safe and respected?', 'What should a caregiver never overlook?'],
  futureMessage: ['Who do you imagine hearing this?', 'What do you most want them to remember?'],
}

type StudioView = 'guided' | 'chapters'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

function answerFor(state: StoryPublicState, fieldKey: StoryFieldKey): StoryPublicAnswer | undefined {
  return state.answers.find((answer) => answer.fieldKey === fieldKey)
}

function optimisticDraft(
  state: StoryPublicState,
  field: StoryFieldDefinition,
  value: string,
  language: StoryLanguage,
): StoryPublicState {
  const existing = answerFor(state, field.key)
  const next: StoryPublicAnswer = {
    fieldKey: field.key,
    section: field.section,
    label: field.label,
    question: field.prompt,
    answer: value,
    language,
    confirmed: false,
    indexStatus: 'not_indexed',
    updatedAt: Date.now(),
    confirmedAt: null,
    ...existing,
    answer: value,
    language,
    confirmed: false,
    indexStatus: 'not_indexed',
    updatedAt: Date.now(),
    confirmedAt: null,
  }
  const answers = [...state.answers.filter((answer) => answer.fieldKey !== field.key), next]
  return {
    ...state,
    answers,
    confirmedCount: answers.filter((answer) => answer.confirmed).length,
  }
}

function statusText(answer: StoryPublicAnswer | undefined): string {
  if (!answer?.confirmed) return 'Draft — review your words before making this memory searchable.'
  if (answer.indexStatus === 'failed') return 'Confirmed — private AI indexing needs attention.'
  if (answer.indexStatus === 'pending') return 'Confirmed — waiting for private AI indexing.'
  return 'Confirmed — available to your private local AI.'
}

function fieldControl(
  field: StoryFieldDefinition,
  value: string,
  language: StoryLanguage,
  onValueChange: (value: string) => void,
  onLanguageChange: (language: StoryLanguage) => void,
) {
  const common = {
    id: `story-${field.key}`,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onValueChange(event.target.value),
  }

  return (
    <>
      {field.input === 'textarea' ? (
        <textarea {...common} rows={6} aria-label={field.label} />
      ) : field.input === 'select' ? (
        <select {...common} aria-label={field.label}>
          <option value="">Choose one</option>
          {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input {...common} type="text" aria-label={field.label} />
      )}
      <label className="my-story__language">
        <span>Language for this memory</span>
        <select
          aria-label="Language for this memory"
          value={language}
          onChange={(event) => onLanguageChange(event.target.value as StoryLanguage)}
        >
          {STORY_LANGUAGES.map((item) => (
            <option key={item.code} value={item.code}>{item.label}</option>
          ))}
        </select>
      </label>
    </>
  )
}

export function MyStory({ client = defaultClient }: { client?: StoryClient }) {
  const [story, setStory] = useState<StoryPublicState | null>(null)
  const [view, setView] = useState<StudioView>('guided')
  const [guidedKey, setGuidedKey] = useState<StoryFieldKey>(STORY_FIELDS[0].key)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [loadingError, setLoadingError] = useState(false)
  const [activeFollowUp, setActiveFollowUp] = useState<string | null>(null)
  const timers = useRef(new Map<StoryFieldKey, ReturnType<typeof setTimeout>>())
  const revisions = useRef(new Map<StoryFieldKey, number>())
  const dirtyFields = useRef(new Set<StoryFieldKey>())
  const storyRef = useRef<StoryPublicState | null>(null)

  useEffect(() => {
    let cancelled = false
    void client.get()
      .then((next) => {
        if (cancelled) return
        storyRef.current = next
        setStory(next)
        setLoadingError(false)
      })
      .catch(() => {
        if (!cancelled) setLoadingError(true)
      })
    return () => {
      cancelled = true
      for (const timer of timers.current.values()) clearTimeout(timer)
      timers.current.clear()
    }
  }, [client])

  const guidedIndex = useMemo(
    () => Math.max(0, STORY_FIELDS.findIndex((field) => field.key === guidedKey)),
    [guidedKey],
  )
  const guidedField = STORY_FIELDS[guidedIndex]

  function commitLocal(next: StoryPublicState) {
    storyRef.current = next
    setStory(next)
  }

  async function persistDraft(
    fieldKey: StoryFieldKey,
    value: string,
    language: StoryLanguage,
    revision: number,
  ) {
    setSaveStatus('saving')
    try {
      const next = await client.saveDraft(fieldKey, value, language)
      if (revisions.current.get(fieldKey) === revision) {
        dirtyFields.current.delete(fieldKey)
        commitLocal(next)
      }
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }

  function scheduleDraft(field: StoryFieldDefinition, value: string, language: StoryLanguage) {
    const current = storyRef.current
    if (!current) return
    const existing = answerFor(current, field.key)
    const wasConfirmed = existing?.confirmed ?? false
    const revision = (revisions.current.get(field.key) ?? 0) + 1
    revisions.current.set(field.key, revision)
    dirtyFields.current.add(field.key)
    commitLocal(optimisticDraft(current, field, value, language))
    setSaveStatus('saving')

    const oldTimer = timers.current.get(field.key)
    if (oldTimer) clearTimeout(oldTimer)
    timers.current.delete(field.key)

    if (wasConfirmed) {
      void persistDraft(field.key, value, language, revision)
      return
    }

    const timer = setTimeout(() => {
      timers.current.delete(field.key)
      void persistDraft(field.key, value, language, revision)
    }, SAVE_DELAY_MS)
    timers.current.set(field.key, timer)
  }

  function changeValue(field: StoryFieldDefinition, value: string) {
    const current = storyRef.current
    const language = current ? answerFor(current, field.key)?.language ?? 'en' : 'en'
    scheduleDraft(field, value, language)
  }

  function changeLanguage(field: StoryFieldDefinition, language: StoryLanguage) {
    const current = storyRef.current
    const value = current ? answerFor(current, field.key)?.answer ?? '' : ''
    scheduleDraft(field, value, language)
  }

  async function flushPendingDrafts() {
    const current = storyRef.current
    if (!current) return
    const fields = [...dirtyFields.current]
    for (const fieldKey of fields) {
      const timer = timers.current.get(fieldKey)
      if (timer) clearTimeout(timer)
      timers.current.delete(fieldKey)
      const answer = answerFor(storyRef.current ?? current, fieldKey)
      if (!answer) continue
      const revision = revisions.current.get(fieldKey) ?? 0
      await persistDraft(fieldKey, answer.answer, answer.language, revision)
    }
  }

  async function confirmField(fieldKey: StoryFieldKey) {
    try {
      if (dirtyFields.current.has(fieldKey)) {
        const current = storyRef.current
        const answer = current ? answerFor(current, fieldKey) : undefined
        if (answer) {
          const timer = timers.current.get(fieldKey)
          if (timer) clearTimeout(timer)
          timers.current.delete(fieldKey)
          const revision = revisions.current.get(fieldKey) ?? 0
          await persistDraft(fieldKey, answer.answer, answer.language, revision)
        }
      }
      const next = await client.confirmField(fieldKey)
      commitLocal(next)
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }

  async function retryIndexing(fieldKey: StoryFieldKey) {
    try {
      const next = await client.retryIndexing(fieldKey)
      commitLocal(next)
    } catch {
      setSaveStatus('error')
    }
  }

  async function saveNow() {
    setSaveStatus('saving')
    try {
      await flushPendingDrafts()
      const next = await client.saveNow()
      commitLocal(next)
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }

  function jumpToSection(section: StorySection) {
    const first = STORY_FIELDS.find((field) => field.section === section)
    if (!first) return
    setGuidedKey(first.key)
    setView('guided')
    setActiveFollowUp(null)
  }

  function renderEditor(field: StoryFieldDefinition, guided: boolean) {
    if (!story) return null
    const answer = answerFor(story, field.key)
    const value = answer?.answer ?? ''
    const language = answer?.language ?? 'en'
    const followUps = FOLLOW_UPS[field.key] ?? []
    return (
      <article className={`my-story__memory ${guided ? 'my-story__memory--guided' : ''}`} data-testid="story-field-editor" key={field.key}>
        <div className="my-story__memory-heading">
          <div>
            <p className="my-story__eyebrow">{field.section}</p>
            <h2>{field.label}</h2>
          </div>
          <span className={`my-story__state ${answer?.confirmed ? 'my-story__state--confirmed' : ''}`}>
            {answer?.confirmed ? 'Confirmed' : 'Draft'}
          </span>
        </div>
        <p className="my-story__prompt">{field.prompt}</p>
        {fieldControl(field, value, language, (next) => changeValue(field, next), (next) => changeLanguage(field, next))}
        {guided && followUps.length > 0 && (
          <div className="my-story__followups" aria-label="Follow-up prompts">
            {followUps.map((prompt) => (
              <button type="button" key={prompt} onClick={() => setActiveFollowUp(prompt)}>{prompt}</button>
            ))}
          </div>
        )}
        {guided && activeFollowUp && followUps.includes(activeFollowUp) && (
          <p className="my-story__followup-note">Consider: {activeFollowUp}</p>
        )}
        <div className="my-story__memory-footer">
          <p>{statusText(answer)}</p>
          <div className="my-story__actions">
            {!answer?.confirmed && value.trim() !== '' && (
              <button type="button" className="my-story__primary" onClick={() => void confirmField(field.key)}>Confirm memory</button>
            )}
            {answer?.confirmed && answer.indexStatus === 'failed' && (
              <button type="button" onClick={() => void retryIndexing(field.key)}>Retry private AI indexing</button>
            )}
          </div>
        </div>
      </article>
    )
  }

  if (loadingError) {
    return (
      <section className="my-story">
        <h1>My Story</h1>
        <p role="alert">We couldn't load My Story. Your private data has not been changed.</p>
        <button type="button" onClick={() => window.location.reload()}>Try again</button>
      </section>
    )
  }

  if (!story) {
    return <section className="my-story"><h1>My Story</h1><p>Loading your private story…</p></section>
  }

  return (
    <section className="my-story">
      <header className="my-story__header">
        <div>
          <p className="my-story__eyebrow">Private on this computer</p>
          <h1>My Story</h1>
          <p>{story.confirmedCount} of {STORY_FIELDS.length} memories confirmed</p>
        </div>
        <div className="my-story__save-area">
          <span aria-live="polite">
            {saveStatus === 'saving' && 'Saving…'}
            {saveStatus === 'saved' && 'Saved privately on this computer'}
            {saveStatus === 'error' && 'Not saved yet — retry'}
          </span>
          <button type="button" onClick={() => void saveNow()}>Save now</button>
        </div>
      </header>

      <div className="my-story__tabs" role="group" aria-label="Story view">
        <button type="button" aria-pressed={view === 'guided'} onClick={() => setView('guided')}>Guided</button>
        <button type="button" aria-pressed={view === 'chapters'} onClick={() => setView('chapters')}>Chapters</button>
      </div>

      <nav className="my-story__chapters" aria-label="Story chapters">
        {STORY_SECTIONS.map((section) => (
          <button type="button" key={section} onClick={() => jumpToSection(section)} aria-label={`Go to ${section} chapter`}>
            {section}
          </button>
        ))}
      </nav>

      {view === 'guided' ? (
        <div className="my-story__guided">
          <p className="my-story__counter">Memory {guidedIndex + 1} of {STORY_FIELDS.length}</p>
          {renderEditor(guidedField, true)}
          <div className="my-story__guided-navigation">
            <button
              type="button"
              disabled={guidedIndex === 0}
              onClick={() => { setGuidedKey(STORY_FIELDS[Math.max(0, guidedIndex - 1)].key); setActiveFollowUp(null) }}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={guidedIndex === STORY_FIELDS.length - 1}
              onClick={() => { setGuidedKey(STORY_FIELDS[Math.min(STORY_FIELDS.length - 1, guidedIndex + 1)].key); setActiveFollowUp(null) }}
            >
              Next
            </button>
          </div>
        </div>
      ) : (
        <div className="my-story__chapter-list">
          {STORY_SECTIONS.map((section) => (
            <section className="my-story__chapter" key={section}>
              <h2>{section}</h2>
              {STORY_FIELDS.filter((field) => field.section === section).map((field) => renderEditor(field, false))}
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
