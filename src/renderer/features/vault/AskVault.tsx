import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, BrainCircuit, FileText, LockKeyhole, Mic, Sparkles, Square, Volume2 } from 'lucide-react'
import type {
  VaultAnswer,
  VaultDocumentSummary,
  VaultQueryScope,
  VoicePublicProgress,
  VoicePublicStatus,
} from '../../../shared/desktopApi'
import { PRIVATE_AI_MODELS } from '../../../shared/privateAiModels'
import { STORY_LANGUAGES, type StoryLanguage } from '../../../shared/story'
import { DesktopSpeechClient } from '../../services/speech/DesktopSpeechClient'
import type { SpeechClient } from '../../services/speech/SpeechClient'
import { DesktopStoryClient } from '../../services/story/DesktopStoryClient'
import type { StoryClient } from '../../services/story/StoryClient'
import { DesktopVaultClient } from '../../services/vault/DesktopVaultClient'
import type { VaultClient } from '../../services/vault/VaultClient'
import { StoryVoiceRecorder, type StoryVoiceRecorderLike } from '../story/StoryVoiceRecorder'
import { StoryVoiceSetup } from '../story/StoryVoiceSetup'
import './AskVault.css'

const defaultClient = new DesktopVaultClient()
const defaultStoryClient = new DesktopStoryClient()
const defaultSpeechClient = new DesktopSpeechClient()

const LANGUAGE_KEY = 'familyCircle.ask.language'
const READ_ALOUD_KEY = 'familyCircle.ask.readAloud'

type ScopeMode = 'story-and-vault' | 'story' | 'all' | 'documents'
type VoiceInputState = 'idle' | 'starting' | 'recording' | 'transcribing'
type ReadAloudState = 'idle' | 'preparing' | 'playing'

const SCOPE_OPTIONS: Array<{ mode: ScopeMode; title: string; hint: string }> = [
  { mode: 'story-and-vault', title: 'My Story and Vault', hint: 'Search your confirmed memories and indexed documents together.' },
  { mode: 'story', title: 'My Story', hint: 'Search only your confirmed My Story memories.' },
  { mode: 'all', title: 'All Vault documents', hint: 'Search every document currently ready to ask.' },
  { mode: 'documents', title: 'Choose Vault documents', hint: 'Limit this question to selected indexed files.' },
]

export interface AudioPlayback {
  done: Promise<void>
  stop(): void
}

/** Plays a WAV made on this computer; nothing leaves the machine. */
export function playWav(wavBytes: Uint8Array): AudioPlayback {
  const url = URL.createObjectURL(new Blob([new Uint8Array(wavBytes)], { type: 'audio/wav' }))
  const audio = new Audio(url)
  let finish: () => void = () => undefined
  const done = new Promise<void>((resolve) => { finish = resolve })
  const cleanup = () => {
    URL.revokeObjectURL(url)
    finish()
  }
  audio.onended = cleanup
  audio.onerror = cleanup
  void audio.play().catch(cleanup)
  return {
    done,
    stop() {
      audio.pause()
      cleanup()
    },
  }
}

function readPreference(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function writePreference(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* preferences are a convenience only */ }
}

function savedLanguage(): StoryLanguage {
  const saved = readPreference(LANGUAGE_KEY)
  return STORY_LANGUAGES.find((option) => option.code === saved)?.code ?? 'en'
}

function languageLabel(code: StoryLanguage): string {
  return STORY_LANGUAGES.find((option) => option.code === code)?.label ?? 'English'
}

function scopeFor(mode: ScopeMode, documentIds: number[]): VaultQueryScope {
  if (mode === 'documents') return { type: 'documents', documentIds }
  return { type: mode }
}

export function AskVault({
  client = defaultClient,
  storyClient = defaultStoryClient,
  speechClient = defaultSpeechClient,
  createVoiceRecorder = () => new StoryVoiceRecorder(),
  playAudio = playWav,
}: {
  client?: VaultClient
  storyClient?: StoryClient
  speechClient?: SpeechClient
  createVoiceRecorder?: () => StoryVoiceRecorderLike
  playAudio?: (wavBytes: Uint8Array) => AudioPlayback
}) {
  const [documents, setDocuments] = useState<VaultDocumentSummary[]>([])
  const [scopeMode, setScopeMode] = useState<ScopeMode>('story-and-vault')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<VaultAnswer | null>(null)
  const [answerLanguage, setAnswerLanguage] = useState<StoryLanguage>('en')
  const [loadingDocuments, setLoadingDocuments] = useState(true)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [language, setLanguage] = useState<StoryLanguage>(savedLanguage)
  const [readAloud, setReadAloud] = useState(() => readPreference(READ_ALOUD_KEY) === 'true')
  const [voiceInput, setVoiceInput] = useState<VoiceInputState>('idle')
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null)
  const [voiceStatus, setVoiceStatus] = useState<VoicePublicStatus | null>(null)
  const [voiceProgress, setVoiceProgress] = useState<VoicePublicProgress | null>(null)
  const [voiceSetupBusy, setVoiceSetupBusy] = useState(false)
  const [voiceSetupError, setVoiceSetupError] = useState<string | null>(null)
  const [readAloudState, setReadAloudState] = useState<ReadAloudState>('idle')
  const [readAloudMessage, setReadAloudMessage] = useState<string | null>(null)
  const recorderRef = useRef<StoryVoiceRecorderLike | null>(null)
  const playbackRef = useRef<AudioPlayback | null>(null)
  const speakRequestRef = useRef(0)
  const showVoiceSetup = voiceStatus !== null && !voiceStatus.ready

  useEffect(() => {
    let cancelled = false
    void client.listDocuments().then(
      (items) => {
        if (!cancelled) {
          setDocuments(items)
          setLoadingDocuments(false)
        }
      },
      () => {
        if (!cancelled) {
          setDocuments([])
          setLoadingDocuments(false)
        }
      },
    )
    return () => { cancelled = true }
  }, [client])

  useEffect(() => () => {
    speakRequestRef.current += 1
    playbackRef.current?.stop()
    playbackRef.current = null
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) void recorder.cancel()
  }, [])

  // Follow the one-time offline voice download while its setup panel is open.
  useEffect(() => {
    if (!showVoiceSetup) return undefined
    try {
      return storyClient.onVoiceSetupProgress((progress) => {
        setVoiceProgress(progress)
        setVoiceStatus((current) => current ? {
          ...current,
          state: progress.state,
          ready: progress.state === 'ready',
          repairRequired: progress.state === 'repair_required',
          message: progress.message,
        } : current)
      })
    } catch {
      return undefined
    }
  }, [showVoiceSetup, storyClient])

  const indexedDocuments = useMemo(
    () => documents.filter((document) => document.indexStatus === 'indexed'),
    [documents],
  )

  const canAsk = question.trim().length > 0
    && !asking
    && voiceInput === 'idle'
    && (scopeMode !== 'documents' || selectedIds.length > 0)

  function toggleDocument(documentId: number): void {
    setSelectedIds((current) => current.includes(documentId)
      ? current.filter((id) => id !== documentId)
      : [...current, documentId])
  }

  function stopReading(): void {
    speakRequestRef.current += 1
    playbackRef.current?.stop()
    playbackRef.current = null
    setReadAloudState('idle')
  }

  function chooseLanguage(next: StoryLanguage): void {
    setLanguage(next)
    writePreference(LANGUAGE_KEY, next)
  }

  function chooseReadAloud(next: boolean): void {
    setReadAloud(next)
    writePreference(READ_ALOUD_KEY, String(next))
    if (!next) stopReading()
  }

  async function readAnswerAloud(text: string, spokenLanguage: StoryLanguage): Promise<void> {
    stopReading()
    const request = speakRequestRef.current
    setReadAloudState('preparing')
    setReadAloudMessage(null)
    try {
      const result = await speechClient.synthesize(text, spokenLanguage)
      if (request !== speakRequestRef.current) return
      if (result.status === 'no-voice') {
        setReadAloudState('idle')
        setReadAloudMessage(`No ${languageLabel(spokenLanguage)} voice is installed on this computer. Add one in Windows Settings › Time & language › Speech.`)
        return
      }
      if (result.status !== 'ok') {
        setReadAloudState('idle')
        setReadAloudMessage('Reading aloud is not available on this computer.')
        return
      }
      const playback = playAudio(result.wavBytes)
      playbackRef.current = playback
      setReadAloudState('playing')
      await playback.done
      if (playbackRef.current === playback) {
        playbackRef.current = null
        setReadAloudState('idle')
      }
    } catch {
      if (request !== speakRequestRef.current) return
      setReadAloudState('idle')
      setReadAloudMessage('The answer could not be read aloud. Please try again.')
    }
  }

  async function submit(): Promise<void> {
    const cleanQuestion = question.trim()
    if (!canAsk || !cleanQuestion) return

    const scope = scopeFor(scopeMode, selectedIds)
    const askedLanguage = language

    stopReading()
    setReadAloudMessage(null)
    setAsking(true)
    setError(null)
    setAnswer(null)
    try {
      const result = await client.ask(cleanQuestion, scope, askedLanguage)
      setAnswer(result)
      setAnswerLanguage(askedLanguage)
      if (readAloud && result.answer.trim()) void readAnswerAloud(result.answer, askedLanguage)
    } catch {
      setError('Private AI could not answer right now. Please try again.')
    } finally {
      setAsking(false)
    }
  }

  async function startVoiceQuestion(): Promise<void> {
    if (recorderRef.current || voiceInput !== 'idle') return
    setVoiceMessage(null)
    setVoiceSetupError(null)
    // Questions are transcribed on this computer, so offline voice must be installed first.
    let status: VoicePublicStatus
    try {
      status = await storyClient.getVoiceStatus()
    } catch {
      setVoiceMessage('Offline voice is not available right now. Please try again.')
      return
    }
    setVoiceStatus(status)
    if (!status.ready) return

    stopReading()
    const recorder = createVoiceRecorder()
    recorderRef.current = recorder
    setVoiceInput('starting')
    try {
      await recorder.start()
      setVoiceInput('recording')
    } catch {
      try { await recorder.cancel() } catch { /* cleanup is best effort */ }
      recorderRef.current = null
      setVoiceInput('idle')
      setVoiceMessage('Microphone access was not available. Check your permission and try again.')
    }
  }

  async function finishVoiceQuestion(): Promise<void> {
    const recorder = recorderRef.current
    if (!recorder) return
    setVoiceInput('transcribing')
    try {
      const wavBytes = await recorder.stop()
      recorderRef.current = null
      const transcript = (await storyClient.transcribeRecording(wavBytes, language)).transcript.trim()
      if (!transcript) {
        setVoiceMessage('No speech was heard. Try asking again.')
        return
      }
      // A spoken question is placed in the box for review; it is only sent when the person presses Ask.
      setQuestion((current) => current.trim() ? `${current.trim()} ${transcript}` : transcript)
      setVoiceMessage('Check your question, then press Ask Private AI.')
    } catch {
      try { await recorder.cancel() } catch { /* cleanup is best effort */ }
      recorderRef.current = null
      setVoiceMessage('Your question could not be transcribed. Please try again.')
    } finally {
      setVoiceInput('idle')
    }
  }

  async function runVoiceSetup(action: 'start' | 'pause' | 'repair'): Promise<void> {
    setVoiceSetupBusy(true)
    setVoiceSetupError(null)
    try {
      const status = action === 'start'
        ? await storyClient.startVoiceSetup()
        : action === 'pause'
          ? await storyClient.pauseVoiceSetup()
          : await storyClient.repairVoiceSetup()
      setVoiceStatus(status)
      if (status.state !== 'downloading' && status.state !== 'verifying') setVoiceProgress(null)
      if (status.ready) setVoiceMessage('Offline voice is ready. Press Ask by voice to start.')
    } catch {
      setVoiceSetupError('Offline voice setup could not continue. Please try again.')
    } finally {
      setVoiceSetupBusy(false)
    }
  }

  return (
    <section className="ask-vault" aria-labelledby="ask-vault-title">
      <header className="ask-vault__header">
        <div>
          <div className="ask-vault__eyebrow"><LockKeyhole size={14} aria-hidden="true" /> Local Private AI</div>
          <h1 id="ask-vault-title">Ask Private AI</h1>
          <p>Ask about your confirmed My Story memories and indexed Vault documents. Everything stays on this computer.</p>
          <p className="ask-vault__models">Answers by {PRIVATE_AI_MODELS.answers} · search by {PRIVATE_AI_MODELS.search} · offline</p>
        </div>
        <div className="ask-vault__privacy"><BrainCircuit size={18} aria-hidden="true" /> Answers only from your private sources</div>
      </header>

      <div className="ask-vault__layout">
        <aside className="ask-vault__scope" aria-label="Question scope">
          <h2>Search scope</h2>
          {SCOPE_OPTIONS.map((option) => (
            <label className="ask-vault__scope-option" key={option.mode}>
              <input
                type="radio"
                name="vault-scope"
                aria-label={option.title}
                checked={scopeMode === option.mode}
                onChange={() => setScopeMode(option.mode)}
              />
              <span>
                <strong>{option.title}</strong>
                <small>{option.hint}</small>
              </span>
            </label>
          ))}

          {scopeMode === 'documents' ? (
            <div className="ask-vault__documents">
              {loadingDocuments ? <p>Loading indexed documents…</p> : null}
              {!loadingDocuments && indexedDocuments.length === 0 ? <p>No indexed documents available.</p> : null}
              {indexedDocuments.map((document) => (
                <label className="ask-vault__document" key={document.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(document.id)}
                    onChange={() => toggleDocument(document.id)}
                  />
                  <FileText size={15} aria-hidden="true" />
                  <span>{document.fileName}</span>
                </label>
              ))}
            </div>
          ) : null}

          <div className="ask-vault__language">
            <h2>Language</h2>
            <label htmlFor="ask-language">Ask and answer in</label>
            <select
              id="ask-language"
              value={language}
              onChange={(event) => chooseLanguage(event.target.value as StoryLanguage)}
            >
              {STORY_LANGUAGES.map((option) => (
                <option key={option.code} value={option.code}>{option.label}</option>
              ))}
            </select>
            <small>Spoken questions, answers and the reading voice use this language.</small>
            <label className="ask-vault__read-aloud">
              <input type="checkbox" checked={readAloud} onChange={(event) => chooseReadAloud(event.target.checked)} />
              <span>Read answers aloud</span>
            </label>
          </div>
        </aside>

        <main className="ask-vault__main">
          <div className="ask-vault__composer">
            <label htmlFor="vault-question">Question</label>
            <textarea
              id="vault-question"
              rows={4}
              value={question}
              placeholder="Ask something from your memories or family documents…"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
            <div className="ask-vault__composer-footer">
              <span>Answers stay local and use only what your private sources say.</span>
              <div className="ask-vault__composer-actions">
                {voiceInput === 'recording' ? (
                  <button type="button" className="ask-vault__voice ask-vault__voice--recording" onClick={() => void finishVoiceQuestion()}>
                    <Square size={14} aria-hidden="true" />
                    Stop and use question
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ask-vault__voice"
                    disabled={asking || voiceInput !== 'idle'}
                    onClick={() => void startVoiceQuestion()}
                  >
                    <Mic size={15} aria-hidden="true" />
                    {voiceInput === 'starting' ? 'Starting microphone…' : voiceInput === 'transcribing' ? 'Transcribing…' : 'Ask by voice'}
                  </button>
                )}
                <button type="button" disabled={!canAsk} onClick={() => void submit()}>
                  <Sparkles size={16} aria-hidden="true" />
                  {asking ? 'Thinking locally…' : 'Ask Private AI'}
                </button>
              </div>
            </div>
            {voiceInput === 'recording' ? (
              <p className="ask-vault__voice-note" aria-live="polite">Listening in {languageLabel(language)}… press Stop when you finish your question.</p>
            ) : null}
            {voiceMessage ? <p className="ask-vault__voice-note" aria-live="polite">{voiceMessage}</p> : null}
            {showVoiceSetup && voiceStatus ? (
              <StoryVoiceSetup
                status={voiceStatus}
                progress={voiceProgress}
                busy={voiceSetupBusy}
                error={voiceSetupError}
                onSetup={() => void runVoiceSetup('start')}
                onPause={() => void runVoiceSetup('pause')}
                onRepair={() => void runVoiceSetup('repair')}
              />
            ) : null}
          </div>

          {error ? <div className="ask-vault__error" role="alert">{error}</div> : null}

          {answer ? (
            <section className="ask-vault__answer" aria-live="polite">
              <div className="ask-vault__answer-heading">
                <BrainCircuit size={19} aria-hidden="true" />
                <h2>Answer</h2>
                {readAloudState === 'idle' ? (
                  <button type="button" className="ask-vault__listen" onClick={() => void readAnswerAloud(answer.answer, answerLanguage)}>
                    <Volume2 size={14} aria-hidden="true" /> Listen
                  </button>
                ) : (
                  <button type="button" className="ask-vault__listen" onClick={stopReading}>
                    <Square size={12} aria-hidden="true" /> {readAloudState === 'preparing' ? 'Preparing voice…' : 'Stop reading'}
                  </button>
                )}
              </div>
              <p className="ask-vault__answer-text">{answer.answer}</p>
              {readAloudMessage ? <p className="ask-vault__voice-note" role="status">{readAloudMessage}</p> : null}

              {answer.sources.length > 0 ? (
                <div className="ask-vault__sources">
                  <h3>Sources</h3>
                  {answer.sources.map((source, index) => (
                    <article key={`${source.sourceType}-${index}`}>
                      <strong>
                        {source.sourceType === 'story'
                          ? <><BookOpen size={14} aria-hidden="true" /> My Story · {source.label}</>
                          : <><FileText size={14} aria-hidden="true" /> {source.fileName}</>}
                      </strong>
                      <p>{source.excerpt}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </main>
      </div>
    </section>
  )
}
