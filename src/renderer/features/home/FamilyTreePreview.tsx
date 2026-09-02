import { List, Network, Plus } from 'lucide-react'
import type { FamilyPerson, FamilyRelationship } from '../../services/circle/types'

type FamilyTreePreviewProps = {
  people: FamilyPerson[]
  relationships: FamilyRelationship[]
  selectedPersonId: string
  onSelectPerson(personId: string): void
}

export function FamilyTreePreview({
  people,
  relationships,
  selectedPersonId,
  onSelectPerson,
}: FamilyTreePreviewProps) {
  const generations = [0, 1, 2]
    .map((generation) => ({ generation, people: people.filter((person) => person.generation === generation) }))
    .filter((row) => row.people.length > 0)

  return (
    <section className="home-card family-tree-card" aria-labelledby="family-tree-heading">
      <div className="family-tree-card__toolbar">
        <div>
          <h2 id="family-tree-heading">Family Tree</h2>
          <span>{people.length} people · {relationships.length} relationships</span>
        </div>
        <div className="tree-view-toggle" aria-label="Family tree view mode">
          <button type="button" className="tree-view-toggle__active">
            <Network size={14} aria-hidden="true" /> Tree View
          </button>
          <button type="button">
            <List size={14} aria-hidden="true" /> List View
          </button>
        </div>
        <button type="button" className="outline-action">
          <Plus size={15} aria-hidden="true" /> Add Person
        </button>
      </div>

      <div className="family-tree-canvas">
        {generations.map((row, rowIndex) => (
          <div className="family-generation" key={row.generation}>
            {rowIndex > 0 && <span className="family-generation__stem" aria-hidden="true" />}
            <div className="family-generation__people">
              {row.people.map((person) => {
                const selected = person.id === selectedPersonId
                return (
                  <button
                    type="button"
                    key={person.id}
                    className={`family-person${selected ? ' family-person--selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => onSelectPerson(person.id)}
                  >
                    <span className="family-person__avatar" aria-hidden="true">{person.initials}</span>
                    <strong>{person.name}</strong>
                    <small>{person.birthYear ?? person.role}</small>
                    {selected && <span className="family-person__you">You</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="tree-controls" aria-label="Tree controls">
        <button type="button" aria-label="Zoom out">−</button>
        <span>100%</span>
        <button type="button" aria-label="Zoom in">+</button>
      </div>
    </section>
  )
}
