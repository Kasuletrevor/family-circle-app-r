import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, UsersRound } from 'lucide-react'
import { useAppServices } from '../../app/services'
import type { HomeSnapshot } from '../../services/circle/types'
import { ActivityList } from './ActivityList'
import { AiStatusCard } from './AiStatusCard'
import { FamilyTreePreview } from './FamilyTreePreview'
import { MemberDetailsPanel } from './MemberDetailsPanel'
import { MetricCard } from './MetricCard'
import { UpcomingList } from './UpcomingList'
import './Home.css'
import './HomeEmpty.css'

type HomeLoadState = 'loading' | 'ready' | 'error'

export function Home() {
  const { circle } = useAppServices()
  const [loadState, setLoadState] = useState<HomeLoadState>('loading')
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null)
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)

  const loadHome = useCallback(async () => {
    setLoadState('loading')
    try {
      const nextSnapshot = await circle.getHomeSnapshot()
      setSnapshot(nextSnapshot)
      setSelectedPersonId((current) => (
        nextSnapshot.state === 'empty' ? null : current ?? nextSnapshot.selectedPersonId
      ))
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }, [circle])

  useEffect(() => {
    void loadHome()
  }, [loadHome])

  const selectedPerson = useMemo(() => {
    if (!snapshot || snapshot.state === 'empty') return null
    return snapshot.people.find((person) => person.id === selectedPersonId)
      ?? snapshot.people.find((person) => person.id === snapshot.selectedPersonId)
      ?? snapshot.people[0]
      ?? null
  }, [selectedPersonId, snapshot])

  if (loadState === 'loading') {
    return (
      <section className="home-loading" aria-live="polite" aria-label="Loading family overview">
        <div className="home-loading__header" />
        <div className="home-loading__grid">
          <div /><div /><div />
        </div>
        <span>Loading your family overview…</span>
      </section>
    )
  }

  if (loadState === 'error' || !snapshot) {
    return (
      <section className="home-error" role="alert">
        <span className="home-error__icon" aria-hidden="true"><AlertCircle size={22} /></span>
        <div>
          <h1>We could not load your family overview.</h1>
          <p>Your private local data has not been changed. Try loading the overview again.</p>
          <button type="button" className="primary-action" onClick={() => void loadHome()}>Try again</button>
        </div>
      </section>
    )
  }

  if (snapshot.state === 'empty') {
    const notLinked = snapshot.reason === 'not-linked'
    return (
      <section className="home-empty" aria-labelledby="home-empty-heading">
        <span className="home-empty__icon" aria-hidden="true"><UsersRound size={24} /></span>
        <div>
          <h1 id="home-empty-heading">{notLinked ? 'Your local account is ready' : 'No family circle yet'}</h1>
          <p>
            {notLinked
              ? 'This account is not linked to a shared family circle yet. Circle setup will be available from My Circles.'
              : 'Create or join a family circle to see shared relatives, relationships, and activity here.'}
          </p>
        </div>
      </section>
    )
  }

  const firstName = selectedPerson?.name.split(' ')[0] || 'there'

  return (
    <div className="home-page">
      <section className="home-summary" aria-labelledby="home-greeting">
        <div className="home-summary__welcome">
          <span className="home-summary__eyebrow">{snapshot.activeCircle.name}</span>
          <h1 id="home-greeting">Good morning, {firstName} <span aria-hidden="true">👋</span></h1>
          <p>Here’s what’s happening in your family circle.</p>
        </div>
        <div className="home-summary__metrics">
          <MetricCard label="Members" value={snapshot.metrics.members} />
          <MetricCard label="Circles" value={snapshot.metrics.circles} />
          {snapshot.metrics.stories != null && <MetricCard label="Stories" value={snapshot.metrics.stories} />}
          {snapshot.metrics.memories != null && <MetricCard label="Memories" value={snapshot.metrics.memories} />}
        </div>
      </section>

      <AiStatusCard />

      <div className="home-dashboard-grid">
        {(snapshot.upcoming.length > 0 || snapshot.activity.length > 0) && (
          <div className="home-dashboard-grid__left">
            {snapshot.upcoming.length > 0 && <UpcomingList items={snapshot.upcoming} />}
            {snapshot.activity.length > 0 && <ActivityList items={snapshot.activity} />}
          </div>
        )}

        {snapshot.people.length > 0 && (
          <FamilyTreePreview
            people={snapshot.people}
            relationships={snapshot.relationships}
            selectedPersonId={selectedPerson?.id ?? ''}
            onSelectPerson={setSelectedPersonId}
          />
        )}

        {selectedPerson && <MemberDetailsPanel person={selectedPerson} />}
      </div>
    </div>
  )
}
