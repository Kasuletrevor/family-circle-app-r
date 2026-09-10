import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CircleOverview, CircleTreePersonRecord } from '../../../shared/desktopApi'
import { useAppServices } from '../../app/services'
import type { CircleClient } from '../../services/circle/CircleClient'
import { FamilyTreeCanvas, type FamilyTreeSelection } from './FamilyTreeCanvas'
import { relationshipsForPerson } from './familyTreeLabels'
import { buildRelationshipPaths, layoutFamilyTree, normalizeFamilyGraph } from './familyTreeLayout'
import './FamilyTree.css'

type LoadState = 'loading' | 'ready' | 'error'

function countLabel(memberCount: number, invitationCount: number): string {
  const members = `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`
  const invitations = `${invitationCount} ${invitationCount === 1 ? 'invitation pending' : 'invitations pending'}`
  return `${members} · ${invitations}`
}

function PersonInspector({
  person,
  viewerPersonId,
  overview,
}: {
  person: CircleTreePersonRecord
  viewerPersonId: string | null
  overview: Extract<CircleOverview, { status: 'ready' }>
}) {
  const relationships = relationshipsForPerson(person.id, overview.tree.relations, overview.tree.people)

  return (
    <aside className="family-tree-page__inspector" aria-label="Person details">
      <span className="family-tree-page__eyebrow">Person</span>
      <h2>{person.name}</h2>
      <p>{person.role}</p>
      <div className="family-tree-page__badges">
        {person.id === viewerPersonId ? <span>You</span> : null}
        {person.kind === 'placeholder' ? <span>Family record</span> : null}
      </div>
      {person.email ? <p>{person.email}</p> : null}
      {relationships.length > 0 ? (
        <ul>
          {relationships.map((relationship) => <li key={relationship}>{relationship}</li>)}
        </ul>
      ) : <p>No relationships recorded yet.</p>}
    </aside>
  )
}

const readOnlyPositionChange = async () => undefined

export function FamilyTreePage({ circle: injectedCircle }: { circle?: CircleClient } = {}) {
  const { circle: contextCircle } = useAppServices()
  const circle = injectedCircle ?? contextCircle
  const [state, setState] = useState<LoadState>('loading')
  const [overview, setOverview] = useState<CircleOverview | null>(null)
  const [selection, setSelection] = useState<FamilyTreeSelection>(null)
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setState('loading')
    try {
      const next = await circle.getOverview()
      if (currentRequest !== requestId.current) return
      setOverview(next)
      setState('ready')
    } catch {
      if (currentRequest !== requestId.current) return
      setOverview(null)
      setState('error')
    }
  }, [circle])

  useEffect(() => {
    void load()
    return () => { requestId.current += 1 }
  }, [load])

  async function handleCircleChange(circleId: string): Promise<void> {
    if (overview?.activeCircleId === circleId) return
    setSelection(null)
    setState('loading')
    try {
      await circle.selectCircle(circleId)
      await load()
    } catch {
      requestId.current += 1
      setOverview(null)
      setState('error')
    }
  }

  if (state === 'loading') {
    return (
      <section className="family-tree-page" aria-busy="true">
        <div className="family-tree-page__status">
          <h1>Family Tree</h1>
          <p>Loading your family tree…</p>
        </div>
      </section>
    )
  }

  if (state === 'error') {
    return (
      <section className="family-tree-page">
        <div className="family-tree-page__status">
          <h1>Family Tree</h1>
          <p>We couldn't sync this Family Tree.</p>
          <button type="button" onClick={() => { void load() }}>Try again</button>
        </div>
      </section>
    )
  }

  if (!overview || overview.status === 'empty') {
    return (
      <section className="family-tree-page">
        <div className="family-tree-page__status">
          <h1>Your family tree starts with a Circle.</h1>
          <p>Create or join a Circle first.</p>
          <Link to="/circles">Go to My Circles</Link>
        </div>
      </section>
    )
  }

  const graph = normalizeFamilyGraph(overview.tree)
  const layout = layoutFamilyTree(graph, overview.tree.positions)
  const paths = buildRelationshipPaths(layout)
  const memberCount = overview.tree.people.filter((person) => person.kind === 'user').length
  const invitationCount = overview.tree.people.filter((person) => person.kind === 'invite').length
  const selectedPerson = selection?.type === 'person'
    ? overview.tree.people.find((person) => person.id === selection.personId && person.kind !== 'invite') ?? null
    : null

  return (
    <section className="family-tree-page">
      <header className="family-tree-page__header">
        <div>
          <span className="family-tree-page__eyebrow">Family connections</span>
          <h1>Family Tree</h1>
          <p>See how your family connects.</p>
        </div>
        <div className="family-tree-page__circle-context">
          <label>
            <span>Circle</span>
            <select
              aria-label="Circle"
              value={overview.activeCircleId}
              onChange={(event) => { void handleCircleChange(event.currentTarget.value) }}
            >
              {overview.circles.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <p>{countLabel(memberCount, invitationCount)}</p>
        </div>
      </header>

      {graph.edges.length === 0 ? (
        <div className="family-tree-page__empty-relations" role="status">
          {overview.viewerIsOwner ? (
            <>
              <strong>Your family members are here.</strong>
              <span>Connect them to build your tree.</span>
            </>
          ) : (
            <>
              <strong>Relationships haven't been added yet.</strong>
              <span>The Circle owner can build this family tree.</span>
            </>
          )}
        </div>
      ) : null}

      <div className="family-tree-page__workspace">
        <FamilyTreeCanvas
          layout={layout}
          paths={paths}
          viewerPersonId={null}
          viewerIsOwner={false}
          selection={selection}
          onSelectionChange={setSelection}
          onPositionChange={readOnlyPositionChange}
        />
        {selectedPerson ? (
          <PersonInspector
            person={selectedPerson}
            viewerPersonId={overview.viewerPersonId}
            overview={overview}
          />
        ) : null}
      </div>
    </section>
  )
}
