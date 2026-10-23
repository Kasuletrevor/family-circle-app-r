import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Send, ShieldAlert, Trash2 } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { MAX_ANGEL_MESSAGE, type AngelChatMessage, type AngelChatOpenResult } from '../../../shared/agenticChat'
import { useAppServices } from '../../app/services'
import { MY_ANGELS_TAB } from './angelMessages'
import './agentic.css'

const NOT_READY: Record<Exclude<AngelChatOpenResult['status'], 'ready'>, string> = {
  'private-ai-needed': 'Set up private AI in Settings to talk with your angels here.',
  'connect-needed': 'Connect your Kin-Keepers.ai account once so Family Circle can get this angel.',
  'not-here': 'This angel runs only on Kin-Keepers.ai.',
  unavailable: "This angel couldn't be opened just now. Try again.",
}
const FAILED = "The angel couldn't answer just now. Try again."

/** "Qwen_Qwen3.5-0.8B-Q4_K_M" becomes "Qwen3.5-0.8B". */
function modelLabel(model: string): string {
  return model.replace(/^Qwen_/, '').replace(/-Q\d.*$/i, '')
}

function ChatMessage({ message }: { message: AngelChatMessage }) {
  if (message.escalation) {
    return (
      <div className="angel-chat__message angel-chat__message--safety" role="note" aria-label="Safety message">
        <ShieldAlert size={18} aria-hidden="true" />
        <p>{message.text}</p>
      </div>
    )
  }
  return (
    <div className={`angel-chat__message angel-chat__message--${message.role}`}>
      <p>{message.text}</p>
      {message.sources.length > 0 ? (
        <ul className="angel-chat__sources" aria-label="Memories used">
          {message.sources.map((source) => <li key={source.label} title={source.excerpt}>{source.label}</li>)}
        </ul>
      ) : null}
    </div>
  )
}

/** A conversation with one of the person's angels, run on this computer with private AI. */
export function AngelChatPage() {
  const { agentic } = useAppServices()
  const [params] = useSearchParams()
  const angelId = params.get('angel') ?? ''
  const [opened, setOpened] = useState<AngelChatOpenResult | null>(null)
  const [messages, setMessages] = useState<AngelChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const sendingRef = useRef(false)

  useEffect(() => {
    if (!agentic) return
    let current = true
    void agentic.openAngelChat(angelId)
      .catch((): AngelChatOpenResult => ({ status: 'unavailable' }))
      .then((result) => {
        if (!current) return
        setOpened(result)
        setMessages(result.status === 'ready' ? result.messages : [])
      })
    return () => { current = false }
  }, [agentic, angelId])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    // One message at a time: the local model answers one question at once.
    if (!agentic || !text || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setNotice(null)
    try {
      const result = await agentic.sendAngelMessage(angelId, text).catch(() => ({ status: 'failed' as const }))
      if (result.status === 'replied') {
        setMessages((list) => [...list, result.person, result.reply])
        setDraft('')
      } else {
        setNotice(result.status === 'failed' ? FAILED : NOT_READY[result.status])
      }
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const clear = async () => {
    if (!agentic) return
    await agentic.clearAngelChat(angelId).catch(() => undefined)
    setMessages([])
    setConfirmingClear(false)
  }

  const back = (
    <Link className="agentic-button angel-chat__back" to={MY_ANGELS_TAB}>
      <ArrowLeft size={16} aria-hidden="true" /> My Guardian Angels
    </Link>
  )

  if (!opened) {
    return <section className="agentic-page angel-chat">{back}<p role="status" className="ga-page__note">Opening…</p></section>
  }
  if (opened.status !== 'ready') {
    return (
      <section className="agentic-page angel-chat">
        {back}
        <div className="ga-page__problem">
          <span>{NOT_READY[opened.status]}</span>
          {opened.status === 'private-ai-needed' ? <Link className="agentic-button" to="/settings">Open Settings</Link> : null}
          {opened.status === 'connect-needed' ? <Link className="agentic-button" to={MY_ANGELS_TAB}>Connect</Link> : null}
        </div>
      </section>
    )
  }

  return (
    <section className="agentic-page angel-chat" aria-labelledby="angel-chat-heading">
      {back}
      <header className="angel-chat__header">
        <h1 id="angel-chat-heading">{opened.angel.name}</h1>
        <p className="ga-page__note">Runs on this computer · llama.cpp · {modelLabel(opened.runtime.model)}</p>
        <p className="ga-page__note">Your conversation stays on this computer. The angel can use your confirmed My Story memories.</p>
        {opened.offline ? <p className="ga-page__note">Using the copy of this angel saved on this computer.</p> : null}
      </header>

      <div className="angel-chat__messages" aria-live="polite">
        {messages.length === 0 ? <p className="ga-page__note">Say hello to start.</p> : null}
        {messages.map((message) => <ChatMessage key={message.id} message={message} />)}
        {sending ? <p role="status" className="ga-page__note">{opened.angel.name} is thinking…</p> : null}
      </div>

      {notice ? <p className="angel-chat__notice" role="alert">{notice}</p> : null}

      <form className="angel-chat__form" onSubmit={(event) => void send(event)}>
        <label htmlFor="angel-message" className="sr-only">Message</label>
        <textarea
          id="angel-message"
          value={draft}
          maxLength={MAX_ANGEL_MESSAGE}
          rows={2}
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="agentic-button agentic-button--primary" disabled={sending || !draft.trim()}>
          <Send size={16} aria-hidden="true" /> Send
        </button>
      </form>

      <div>
        <button type="button" className="agentic-button agentic-button--danger" onClick={() => setConfirmingClear(true)}>
          <Trash2 size={16} aria-hidden="true" /> Clear this angel's history
        </button>
      </div>

      {confirmingClear ? (
        <div className="ga-dialog-backdrop" role="presentation">
          <section className="ga-dialog" role="dialog" aria-modal="true" aria-labelledby="angel-clear-title">
            <h2 id="angel-clear-title">Clear {opened.angel.name}'s history?</h2>
            <p>This deletes the conversation from this computer and can't be undone.</p>
            <div className="ga-dialog__actions">
              <button type="button" className="agentic-button" onClick={() => setConfirmingClear(false)}>Cancel</button>
              <button type="button" className="agentic-button agentic-button--danger-solid" onClick={() => void clear()}>Clear history</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
