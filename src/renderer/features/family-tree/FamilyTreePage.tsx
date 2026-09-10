import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FAMILY_RELATIONSHIP_KINDS,
  type CircleOverview,
  type CircleTreePersonRecord,
  type FamilyRelationshipKind,
} from '../../../shared/desktopApi'
import { useAppServices } from '../../app/services'
import type { CircleClient } from '../../services/circle/CircleClient'
import { FamilyTreeCanvas, type FamilyTreeSelection } from './FamilyTreeCanvas'
import { relationshipsForPerson } from './familyTreeLabels'
import { buildRelationshipPaths, layoutFamilyTree, normalizeFamilyGraph } from './familyTreeLayout'
import './FamilyTree.css'

type LoadState = 'loading' | 'ready' | 'error'

const RELATIONSHIP_LABELS: Record<FamilyRelationshipKind, string> = {
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
  grandparent: 'Grandparent',
  spouse: 'Spouse / Partner',
  sibling: 'Sibling',
  aunt_uncle: 'Aunt / Uncle',
  cousin: 'Cousin',
}

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
  const [showAddRelation, setShowAddRelation] = useState(false)
  const [firstPersonId, setFirstPersonId] = useState('')
  const [relationshipKind, setRelationshipKind] = useState<FamilyRelationshipKind>('mother')
  const [secondPersonId, setSecondPersonId] = useState('')
  const [relationshipBusy, setRelationshipBusy] = useState(false)
  const [relationshipError, setRelationshipError] = useState<string | null>(null)
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

  function resetRelationshipForm(): void {
    setShowAddRelation(false)
    setFirstPersonId('')
    setRelationshipKind('mother')
    setSecondPersonId('')
    setRelationshipBusy(false)
    setRelationshipError(null)
  }

  async function handleCircleChange(circleId: string): Promise<void> {
    if (overview?.activeCircleId === circleId) return
    setSelection(null)
    resetRelationshipForm()
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

  async function handleAddRelation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!overview || overview.status !== 'ready' || !overview.viewerIsOwner) return
    if (!firstPersonId || !secondPersonId || firstPersonId === secondPersonId) return

    const confirmedPersonIds = new Set(
      overview.tree.people.filter((person) => person.kind === 'user').map((person) => person.id),
    )
    if (!confirmedPersonIds.has(firstPersonId) || !confirmedPersonIds.has(secondPersonId)) return

    setRelationshipBusy(true)
    setRelationshipError(null)
    try {
      await circle.addTreeRelation({
        kind: relationshipKind,
        aPersonId: firstPersonId,
        bPersonId: secondPersonId,
      })
      resetRelationshipForm()
      await load()
    } catch {
      setRelationshipBusy(false)
      setRelationshipError('Could not add this relationship. Please try again.')
    }
  }

  if (state === 'loading') {
    return (
      <section className="family-tree-page" aria-busy="true" aria-label="Loading Family Tree">
        <div className="family-tree-page__status">
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
  const confirmedPeople = overview.tree.people.filter((person) => person.kind === 'user')
  const selectedPerson = selection?.type === 'person'
    ? overview.tree.people.find((person) => person.id === selection.personId && person.kind !== 'invite') ?? null
    : null
  const relationshipFormValid = firstPersonId !== ''
    && secondPersonId !== ''
    && firstPersonId !== secondPersonId

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

      {overview.viewerIsOwner ? (
        <div className="family-tree-page__relationship-tools">
          <button
            type="button"
            onClick={() => {
              setShowAddRelation((visible) => !visible)
              setRelationshipError(null)
            }}
          >
            {showAddRelation ? 'Cancel' : 'Add relationship'}
          </button>

          {showAddRelation ? (
            <form
              className="family-tree-page__relationship-form"
              aria-label="Add relationship"
              onSubmit={(event) => { void handleAddRelation(event) }}
            >
              <label>
                <span>First person</span>
                <select
                  aria-label="First person"
                  value={firstPersonId}
                  disabled={relationshipBusy}
                  onChange={(event) => {
                    const nextId = event.currentTarget.value
                    setFirstPersonId(nextId)
                    if (nextId === secondPersonId) setSecondPersonId('')
                  }}
                >
                  <option value="">Select person</option>
                  {confirmedPeople.map((person) => (
                    <option key={person.id} value={person.id} disabled={person.id === secondPersonId}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>

              <span className="family-tree-page__relationship-joiner">is</span>

              <label>
                <span>Relationship</span>
                <select
                  aria-label="Relationship"
                  value={relationshipKind}
                  disabled={relationshipBusy}
                  onChange={(event) => setRelationshipKind(event.currentTarget.value as FamilyRelationshipKind)}
                >
                  {FAMILY_RELATIONSHIP_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{RELATIONSHIP_LABELS[kind]}</option>
                  ))}
                </select>
              </label>

              <span className="family-tree-page__relationship-joiner">of</span>

              <label>
                <span>Second person</span>
                <select
                  aria-label="Second person"
                  value={secondPersonId}
                  disabled={relationshipBusy}
                  onChange={(event) => {
                    const nextId = event.currentTarget.value
                    setSecondPersonId(nextId)
                    if (nextId === firstPersonId) setFirstPersonId('')
                  }}
                >
                  <option value="">Select person</option>
                  {confirmedPeople.map((person) => (
                    <option key={person.id} value={person.id} disabled={person.id === firstPersonId}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>

              <button type="submit" disabled={!relationshipFormValid || relationshipBusy}>
                {relationshipBusy ? 'Saving…' : 'Save relationship'}
              </button>
              {relationshipError ? <p role="alert">{relationshipError}</p> : null}
            </form>
          ) : null}
        </div>
      ) : null}

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
