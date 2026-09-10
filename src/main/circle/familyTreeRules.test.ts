import { describe, expect, it } from 'vitest'
import type { CircleTreePersonRecord, CircleTreeRelationRecord } from '../../shared/desktopApi'
import {
  TREE_COORDINATE_LIMIT,
  canonicalizeTreeRelation,
  validateTreePosition,
  validateTreeRelation,
} from './familyTreeRules'

const userPeople: CircleTreePersonRecord[] = [
  { id: 'user:1', kind: 'user', name: 'A', email: null, role: 'Family member' },
  { id: 'user:2', kind: 'user', name: 'B', email: null, role: 'Family member' },
  { id: 'user:3', kind: 'user', name: 'C', email: null, role: 'Family member' },
]

describe('Family Tree relationship rules', () => {
  it('canonicalizes undirected spouse endpoints', () => {
    expect(canonicalizeTreeRelation({ kind: 'spouse', aPersonId: 'user:9', bPersonId: 'user:2' }))
      .toEqual({ kind: 'spouse', aPersonId: 'user:2', bPersonId: 'user:9' })
  })

  it('canonicalizes sibling and cousin endpoints but keeps directed endpoints in semantic order', () => {
    expect(canonicalizeTreeRelation({ kind: 'sibling', aPersonId: 'user:9', bPersonId: 'user:2' }))
      .toEqual({ kind: 'sibling', aPersonId: 'user:2', bPersonId: 'user:9' })
    expect(canonicalizeTreeRelation({ kind: 'cousin', aPersonId: 'user:9', bPersonId: 'user:2' }))
      .toEqual({ kind: 'cousin', aPersonId: 'user:2', bPersonId: 'user:9' })
    expect(canonicalizeTreeRelation({ kind: 'mother', aPersonId: 'user:9', bPersonId: 'user:2' }))
      .toEqual({ kind: 'mother', aPersonId: 'user:9', bPersonId: 'user:2' })
    expect(canonicalizeTreeRelation({ kind: 'aunt_uncle', aPersonId: 'user:9', bPersonId: 'user:2' }))
      .toEqual({ kind: 'aunt_uncle', aPersonId: 'user:9', bPersonId: 'user:2' })
  })

  it('rejects self relationships', () => {
    expect(() => validateTreeRelation(
      { kind: 'sibling', aPersonId: 'user:1', bPersonId: 'user:1' },
      userPeople,
      [],
    )).toThrow('Choose two different Circle members')
  })

  it('rejects relation endpoints that are not confirmed user nodes', () => {
    expect(() => validateTreeRelation(
      { kind: 'sibling', aPersonId: 'user:1', bPersonId: 'placeholder:p1' },
      [
        { id: 'user:1', kind: 'user', name: 'A', email: null, role: 'Member' },
        { id: 'placeholder:p1', kind: 'placeholder', name: 'B', email: null, role: '' },
      ],
      [],
    )).toThrow('Choose confirmed Circle members')
  })

  it('rejects relation endpoints that are not in the authoritative tree', () => {
    expect(() => validateTreeRelation(
      { kind: 'mother', aPersonId: 'user:1', bPersonId: 'user:404' },
      userPeople,
      [],
    )).toThrow('Choose confirmed Circle members')
  })

  it('rejects duplicate symmetric relationships regardless of endpoint order', () => {
    expect(() => validateTreeRelation(
      { kind: 'sibling', aPersonId: 'user:2', bPersonId: 'user:1' },
      userPeople,
      [{ id: 'r1', kind: 'sibling', aPersonId: 'user:1', bPersonId: 'user:2' }],
    )).toThrow('That relationship already exists')
  })

  it('rejects duplicate directed relationships but keeps inverse non-ancestry directed relationships distinct', () => {
    const relations: CircleTreeRelationRecord[] = [
      { id: 'r1', kind: 'aunt_uncle', aPersonId: 'user:1', bPersonId: 'user:2' },
    ]
    expect(() => validateTreeRelation(
      { kind: 'aunt_uncle', aPersonId: 'user:1', bPersonId: 'user:2' },
      userPeople,
      relations,
    )).toThrow('That relationship already exists')
    expect(validateTreeRelation(
      { kind: 'aunt_uncle', aPersonId: 'user:2', bPersonId: 'user:1' },
      userPeople,
      relations,
    )).toEqual({ kind: 'aunt_uncle', aPersonId: 'user:2', bPersonId: 'user:1' })
  })

  it('rejects an ancestry edge that would close a cycle', () => {
    const relations: CircleTreeRelationRecord[] = [
      { id: 'r1', kind: 'mother', aPersonId: 'user:1', bPersonId: 'user:2' },
      { id: 'r2', kind: 'father', aPersonId: 'user:2', bPersonId: 'user:3' },
    ]
    expect(() => validateTreeRelation(
      { kind: 'guardian', aPersonId: 'user:3', bPersonId: 'user:1' },
      userPeople,
      relations,
    )).toThrow('That relationship would create an ancestry loop')
  })

  it('terminates safely when historical ancestry data already contains a cycle', () => {
    const relations: CircleTreeRelationRecord[] = [
      { id: 'r1', kind: 'mother', aPersonId: 'user:1', bPersonId: 'user:2' },
      { id: 'r2', kind: 'father', aPersonId: 'user:2', bPersonId: 'user:1' },
    ]
    expect(() => validateTreeRelation(
      { kind: 'grandparent', aPersonId: 'user:3', bPersonId: 'user:1' },
      userPeople,
      relations,
    )).not.toThrow()
  })

  it('accepts finite coordinate bounds and rejects invalid position values', () => {
    expect(TREE_COORDINATE_LIMIT).toBe(100_000)
    expect(validateTreePosition({ personId: 'user:1', x: 100000, y: -100000 }))
      .toEqual({ personId: 'user:1', x: 100000, y: -100000 })
    expect(() => validateTreePosition({ personId: 'user:1', x: 100001, y: 0 }))
      .toThrow('Choose a valid tree position')
    expect(() => validateTreePosition({ personId: 'user:1', x: Number.NaN, y: 0 }))
      .toThrow('Choose a valid tree position')
    expect(() => validateTreePosition({ personId: '', x: 0, y: 0 }))
      .toThrow('Choose a valid tree position')
  })
})
