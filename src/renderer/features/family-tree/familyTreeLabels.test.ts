import { describe, expect, it } from 'vitest'
import type { CircleTreePersonRecord, CircleTreeRelationRecord } from '../../../shared/desktopApi'
import { relationshipSentence, relationshipsForPerson } from './familyTreeLabels'

const people: CircleTreePersonRecord[] = [
  { id: 'user:sarah', kind: 'user', name: 'Sarah', email: 'sarah@example.test', role: 'Mother' },
  { id: 'user:trevor', kind: 'user', name: 'Trevor', email: 'trevor@example.test', role: 'Family member' },
  { id: 'user:ruth', kind: 'user', name: 'Ruth', email: 'ruth@example.test', role: 'Family member' },
]

const motherRelation: CircleTreeRelationRecord = {
  id: 'r-mother',
  kind: 'mother',
  aPersonId: 'user:sarah',
  bPersonId: 'user:trevor',
}

const siblingRelation: CircleTreeRelationRecord = {
  id: 'r-sibling',
  kind: 'sibling',
  aPersonId: 'user:sarah',
  bPersonId: 'user:ruth',
}

describe('Family Tree relationship labels', () => {
  it('renders directed relationship sentences in plain language', () => {
    expect(relationshipSentence(motherRelation, people)).toBe('Sarah is the mother of Trevor')
    expect(relationshipsForPerson('user:trevor', [motherRelation], people)).toContain('Child of Sarah')
    expect(relationshipsForPerson('user:sarah', [motherRelation], people)).toContain('Mother of Trevor')
  })

  it('renders symmetric relationships identically from either endpoint', () => {
    expect(relationshipsForPerson('user:sarah', [siblingRelation], people)).toContain('Sibling of Ruth')
    expect(relationshipsForPerson('user:ruth', [siblingRelation], people)).toContain('Sibling of Sarah')
  })

  it('derives useful inverse labels for other directed family relationships', () => {
    const relations: CircleTreeRelationRecord[] = [
      { id: 'r-grand', kind: 'grandparent', aPersonId: 'user:sarah', bPersonId: 'user:trevor' },
      { id: 'r-aunt', kind: 'aunt_uncle', aPersonId: 'user:ruth', bPersonId: 'user:trevor' },
      { id: 'r-guardian', kind: 'guardian', aPersonId: 'user:sarah', bPersonId: 'user:ruth' },
    ]

    expect(relationshipsForPerson('user:trevor', relations, people)).toEqual(expect.arrayContaining([
      'Grandchild of Sarah',
      'Niece / nephew of Ruth',
    ]))
    expect(relationshipsForPerson('user:ruth', relations, people)).toContain('Under guardianship of Sarah')
  })

  it('degrades unknown legacy relationship kinds to readable neutral text instead of throwing', () => {
    const legacy: CircleTreeRelationRecord = {
      id: 'r-legacy',
      kind: 'friend',
      aPersonId: 'user:sarah',
      bPersonId: 'user:trevor',
    }

    const sentence = relationshipSentence(legacy, people)
    expect(sentence).toContain('Sarah')
    expect(sentence).toContain('Trevor')
    expect(sentence.toLowerCase()).toContain('friend')
    expect(relationshipsForPerson('user:sarah', [legacy], people)[0].toLowerCase()).toContain('friend')
  })

  it('remains readable when historical relations reference a missing person', () => {
    const stale: CircleTreeRelationRecord = {
      id: 'r-stale',
      kind: 'father',
      aPersonId: 'user:missing',
      bPersonId: 'user:trevor',
    }

    expect(() => relationshipSentence(stale, people)).not.toThrow()
    expect(relationshipSentence(stale, people)).toContain('Family member')
  })
})
