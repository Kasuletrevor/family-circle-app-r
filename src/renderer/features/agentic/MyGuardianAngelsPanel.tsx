import { useCallback, useEffect, useRef, useState } from 'react'
import { Cloud, LogIn, Play, RefreshCw, Server, Settings, Trash2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { AngelConnection, MyAngelsResult, MyGuardianAngel } from '../../../shared/agentic'
import { useAppServices } from '../../app/services'
import { addResultMessage, CONNECTION_ENDED, GUARDIAN_ANGEL_VIEW, UNREACHABLE } from './angelMessages'
import { CardAvatar, SafetyRules } from './cardParts'

type ListState = { status: 'loading' } | MyAngelsResult

function runsText(angel: MyGuardianAngel): string {
  if (angel.runCount === 0) return 'Never run'
  const runs = angel.runCount === 1 ? 'Ran once' : `Ran ${angel.runCount} times`
  if (!angel.lastRunAt) return runs
  const last = new Date(angel.lastRunAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return `${runs}, last on ${last}`
}

function AngelCard({ angel, onOpen, onRemove }: {
  angel: MyGuardianAngel
  onOpen(page: 'edit' | 'run'): void
  onRemove(): void
}) {
  const headingId = `ga-angel-${angel.id}`
  return (
    <article className="ga-card" aria-labelledby={headingId}>
      <div className="ga-card__top">
        <CardAvatar name={angel.name} avatar={angel.avatar} />
        <div>
          <h3 id={headingId}>{angel.name}</h3>
          {angel.templateName ? <p className="ga-card__meta">Based on {angel.templateName}</p> : null}
        </div>
      </div>
      {angel.description ? <p className="ga-card__description">{angel.description}</p> : null}
      <p className="ga-card__meta">
        {angel.usesCloudAi
          ? <span className="ga-badge ga-badge--cloud"><Cloud size={14} aria-hidden="true" /> Uses cloud AI (OpenAI)</span>
          : <span className="ga-badge"><Server size={14} aria-hidden="true" /> Runs on Kin-Keepers servers</span>}
      </p>
      <p className="ga-card__meta">{runsText(angel)}</p>
      <SafetyRules trustBoundaries={angel.trustBoundaries} escalationTriggers={angel.escalationTriggers} />
      <div className="ga-card__actions">
        <button type="button" className="agentic-button" onClick={() => onOpen('edit')}>
          <Settings size={16} aria-hidden="true" /> Settings
        </button>
        <button type="button" className="agentic-button" onClick={() => onOpen('run')}>
          <Play size={16} aria-hidden="true" /> Test
        </button>
        <button type="button" className="agentic-button agentic-button--danger" onClick={onRemove}>
          <Trash2 size={16} aria-hidden="true" /> Remove
        </button>
      </div>
    </article>
  )
}

function RemoveAngelDialog({ angel, removing, onCancel, onConfirm }: {
  angel: MyGuardianAngel
  removing: boolean
  onCancel(): void
  onConfirm(): void
}) {
  return (
    <div className="ga-dialog-backdrop" role="presentation">
      <section className="ga-dialog" role="dialog" aria-modal="true" aria-labelledby="ga-remove-title">
        <h2 id="ga-remove-title">Remove {angel.name} from your Guardian Angels?</h2>
        <p>This deletes it on Kin-Keepers.ai and can't be undone.</p>
        <div className="ga-dialog__actions">
          <button type="button" className="agentic-button" disabled={removing} onClick={onCancel}>Cancel</button>
          <button type="button" className="agentic-button agentic-button--danger-solid" disabled={removing} onClick={onConfirm}>
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </section>
    </div>
  )
}

/** The person's own Guardian Angels on Kin-Keepers.ai, once their account is connected. */
export function MyGuardianAngelsPanel({ onBrowse }: { onBrowse(): void }) {
  const { agentic } = useAppServices()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const pendingAdd = params.get('add')
  const [connection, setConnection] = useState<AngelConnection | null>(null)
  const [list, setList] = useState<ListState>({ status: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<MyGuardianAngel | null>(null)
  const [removing, setRemoving] = useState(false)
  const finishedAdd = useRef<string | null>(null)
  const connected = connection?.status === 'connected'

  const load = useCallback(async () => {
    if (!agentic) return
    setList({ status: 'loading' })
    try {
      setList(await agentic.getMyAngels())
    } catch {
      setList({ status: 'unavailable' })
    }
  }, [agentic])

  useEffect(() => {
    if (!agentic) return undefined
    let active = true
    void agentic.getAngelConnection()
      .then((value) => { if (active) setConnection(value) })
      .catch(() => { if (active) setConnection({ status: 'disconnected' }) })
    const stop = agentic.onAngelConnection((value) => { if (active) setConnection(value) })
    return () => {
      active = false
      stop()
    }
  }, [agentic])

  useEffect(() => {
    if (connected) void load()
  }, [connected, load])

  // Finish an "Add to my Guardian Angels" that had to connect first.
  useEffect(() => {
    if (!agentic || !connected || !pendingAdd || finishedAdd.current === pendingAdd) return
    finishedAdd.current = pendingAdd
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('add')
      return next
    }, { replace: true })
    void agentic.addAngel(pendingAdd)
      .then((result) => setNotice(addResultMessage(result)))
      .catch(() => setNotice(UNREACHABLE))
      .then(() => load())
  }, [agentic, connected, pendingAdd, setParams, load])

  const connect = async () => {
    if (!agentic) return
    setNotice(null)
    try {
      await agentic.connect()
      navigate(`${GUARDIAN_ANGEL_VIEW}?page=connect`)
    } catch {
      setNotice(UNREACHABLE)
    }
  }

  const disconnect = async () => {
    setNotice(null)
    await agentic?.disconnect().catch(() => undefined)
  }

  const confirmRemove = async () => {
    if (!agentic || !confirming) return
    const angel = confirming
    setRemoving(true)
    try {
      const result = await agentic.removeAngel(angel.id)
      if (result.status === 'removed') setNotice(`Removed ${angel.name}.`)
      else if (result.status === 'not-yours') setNotice(`${angel.name} belongs to another account, so it wasn't removed.`)
      else if (result.status === 'unavailable') setNotice(UNREACHABLE)
    } catch {
      setNotice(UNREACHABLE)
    } finally {
      setRemoving(false)
      setConfirming(null)
    }
    await load()
  }

  if (!agentic) return <p className="ga-page__note">Agentic Services are not available here.</p>
  if (!connection) return <p className="ga-page__note" role="status">Checking your Kin-Keepers.ai connection…</p>

  if (!connected) {
    return (
      <div className="ga-connect">
        <h2>Connect your Kin-Keepers.ai account</h2>
        <p>Connect your Kin-Keepers.ai account to see and manage your Guardian Angels. Family Circle shares nothing about your family.</p>
        {connection.status === 'disconnected' && connection.problem === 'connect-failed'
          ? <p className="ga-page__problem" role="alert">Couldn't connect. Try again.</p>
          : null}
        {connection.status === 'disconnected' && connection.problem === 'ended'
          ? <p className="ga-page__problem" role="alert">{CONNECTION_ENDED}</p>
          : null}
        {notice ? <p className="ga-notice" role="status">{notice}</p> : null}
        <button type="button" className="agentic-button agentic-button--primary" onClick={() => void connect()}>
          <LogIn size={16} aria-hidden="true" />
          {connection.status === 'disconnected' && connection.problem === 'connect-failed' ? 'Try again' : 'Connect Kin-Keepers.ai'}
        </button>
      </div>
    )
  }

  return (
    <div className="ga-mine">
      <div className="ga-mine__account">
        <span>{connection.email ? `Connected as ${connection.email}` : 'Connected to Kin-Keepers.ai'}</span>
        <button type="button" className="agentic-button" onClick={() => void disconnect()}>Disconnect</button>
      </div>
      {notice ? <p className="ga-notice" role="status">{notice}</p> : null}
      {list.status === 'loading' ? <p className="ga-page__note" role="status">Loading your Guardian Angels…</p> : null}
      {list.status === 'unavailable' ? (
        <div className="ga-page__problem" role="alert">
          <span>{UNREACHABLE}</span>
          <button type="button" className="agentic-button" onClick={() => void load()}>
            <RefreshCw size={16} aria-hidden="true" /> Retry
          </button>
        </div>
      ) : null}
      {list.status === 'ready' && list.angels.length === 0 ? (
        <div className="ga-page__note">
          <p>You have no Guardian Angels yet.</p>
          <button type="button" className="agentic-button" onClick={onBrowse}>Browse templates</button>
        </div>
      ) : null}
      {list.status === 'ready' && list.angels.length > 0 ? (
        <div className="ga-grid">
          {list.angels.map((angel) => (
            <AngelCard
              key={angel.id}
              angel={angel}
              onOpen={(page) => navigate(`${GUARDIAN_ANGEL_VIEW}?angel=${encodeURIComponent(angel.id)}&page=${page}`)}
              onRemove={() => setConfirming(angel)}
            />
          ))}
        </div>
      ) : null}
      {confirming ? (
        <RemoveAngelDialog
          angel={confirming}
          removing={removing}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void confirmRemove()}
        />
      ) : null}
    </div>
  )
}
