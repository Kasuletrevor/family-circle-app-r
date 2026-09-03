import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppServices } from '../../app/services'
import type { CircleSummary } from '../../services/circle/types'
import './MyCircles.css'

type LoadState =
  | { status: 'loading'; circles: CircleSummary[] }
  | { status: 'ready'; circles: CircleSummary[] }
  | { status: 'error'; circles: CircleSummary[] }

function memberLabel(count: number | null): string {
  const safeCount = count ?? 0
  return `${safeCount} ${safeCount === 1 ? 'member' : 'members'}`
}

export function MyCircles() {
  const { circle } = useAppServices()
  const navigate = useNavigate()
  const [reloadVersion, setReloadVersion] = useState(0)
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading', circles: [] })
  const [openingCircleId, setOpeningCircleId] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadState((current) => ({ status: 'loading', circles: current.circles }))

    void circle.getMyCircles().then(
      (circles) => {
        if (!cancelled) setLoadState({ status: 'ready', circles })
      },
      () => {
        if (!cancelled) setLoadState((current) => ({ status: 'error', circles: current.circles }))
      },
    )

    return () => {
      cancelled = true
    }
  }, [circle, reloadVersion])

  async function openCircle(circleId: string): Promise<void> {
    if (openingCircleId) return
    setOpeningCircleId(circleId)
    setSelectionError(null)
    try {
      await circle.selectCircle(circleId)
      navigate('/')
    } catch {
      setSelectionError('That Circle is no longer available to your account.')
      setOpeningCircleId(null)
    }
  }

  const circles = loadState.circles

  return (
    <section className="my-circles" aria-labelledby="my-circles-title">
      <header className="my-circles__header">
        <div>
          <p className="my-circles__eyebrow">Family spaces</p>
          <h1 id="my-circles-title">My Circles</h1>
          <p>Choose the family circle you want to open, or create a new private space.</p>
        </div>
        <button className="my-circles__primary" type="button">
          Create Circle
        </button>
      </header>

      {selectionError ? <div className="my-circles__notice" role="alert">{selectionError}</div> : null}

      {loadState.status === 'loading' && circles.length === 0 ? (
        <div className="my-circles__state" role="status">Loading your Circles…</div>
      ) : null}

      {loadState.status === 'error' ? (
        <div className="my-circles__state my-circles__state--error" role="alert">
          <h2>We couldn't load your Circles. Please try again.</h2>
          <button type="button" className="my-circles__secondary" onClick={() => setReloadVersion((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : null}

      {loadState.status === 'ready' && circles.length === 0 ? (
        <div className="my-circles__state my-circles__state--empty">
          <div className="my-circles__empty-mark" aria-hidden="true">K</div>
          <h2>Your family starts here</h2>
          <p>Create a private family circle, then invite the people you want to connect with.</p>
          <button className="my-circles__primary" type="button">
            Create your first Circle
          </button>
        </div>
      ) : null}

      {loadState.status === 'ready' && circles.length > 0 ? (
        <div className="my-circles__grid">
          {circles.map((item) => {
            const isOpening = openingCircleId === item.id
            const canInvite = item.role === 'Circle owner'
            return (
              <article className={`my-circles__card${item.isActive ? ' my-circles__card--active' : ''}`} key={item.id}>
                <div className="my-circles__card-head">
                  <div className="my-circles__circle-mark" aria-hidden="true">{item.name.trim().charAt(0).toUpperCase() || 'K'}</div>
                  {item.isActive ? <span className="my-circles__active-label">Active</span> : null}
                </div>
                <div className="my-circles__card-copy">
                  <h2>{item.name}</h2>
                  <p className="my-circles__role">{item.role || 'Family member'}</p>
                  <p className="my-circles__members">{memberLabel(item.memberCount)}</p>
                </div>
                <div className="my-circles__actions">
                  <button
                    className="my-circles__secondary"
                    type="button"
                    disabled={openingCircleId !== null}
                    aria-label={`Open ${item.name}`}
                    onClick={() => void openCircle(item.id)}
                  >
                    {isOpening ? 'Opening…' : 'Open Circle'}
                  </button>
                  {canInvite ? (
                    <button className="my-circles__link-action" type="button" aria-label={`Invite to ${item.name}`}>
                      Invite
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
