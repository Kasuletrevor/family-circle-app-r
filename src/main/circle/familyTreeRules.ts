import {
  FAMILY_RELATIONSHIP_KINDS,
  TREE_COORDINATE_LIMIT,
} from '../../shared/desktopApi'
import type {
  AddTreeRelationInput,
  CircleTreePersonRecord,
  CircleTreeRelationRecord,
  FamilyRelationshipKind,
  SaveTreePositionInput,
} from '../../shared/desktopApi'

export { TREE_COORDINATE_LIMIT } from '../../shared/desktopApi'

const UNDIRECTED = new Set<FamilyRelationshipKind>(['spouse', 'sibling', 'cousin'])
const ANCESTRY = new Set<string>(['mother', 'father', 'guardian', 'grandparent'])
const ALLOWED = new Set<string>(FAMILY_RELATIONSHIP_KINDS)

function canonicalEndpoints(kind: string, aPersonId: string, bPersonId: string) {
  if (UNDIRECTED.has(kind as FamilyRelationshipKind) && aPersonId.localeCompare(bPersonId) > 0) {
    return { aPersonId: bPersonId, bPersonId: aPersonId }
  }
  return { aPersonId, bPersonId }
}

export function canonicalizeTreeRelation(input: AddTreeRelationInput): AddTreeRelationInput {
  const aPersonId = String(input.aPersonId ?? '').trim()
  const bPersonId = String(input.bPersonId ?? '').trim()
  const endpoints = canonicalEndpoints(String(input.kind), aPersonId, bPersonId)
  return { kind: input.kind, ...endpoints }
}

function wouldCreateAncestryCycle(
  input: AddTreeRelationInput,
  relations: CircleTreeRelationRecord[],
): boolean {
  if (!ANCESTRY.has(input.kind)) return false

  const adjacency = new Map<string, Set<string>>()
  for (const relation of relations) {
    if (!ANCESTRY.has(String(relation.kind))) continue
    const from = String(relation.aPersonId ?? '').trim()
    const to = String(relation.bPersonId ?? '').trim()
    if (!from || !to) continue
    const targets = adjacency.get(from) ?? new Set<string>()
    targets.add(to)
    adjacency.set(from, targets)
  }

  const pending = [input.bPersonId]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current === input.aPersonId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) pending.push(next)
    }
  }
  return false
}

export function validateTreeRelation(
  input: AddTreeRelationInput,
  people: CircleTreePersonRecord[],
  relations: CircleTreeRelationRecord[],
): AddTreeRelationInput {
  const kind = String(input.kind ?? '')
  if (!ALLOWED.has(kind)) throw new Error('Choose a valid family relationship')

  const canonical = canonicalizeTreeRelation(input)
  if (!canonical.aPersonId || !canonical.bPersonId) {
    throw new Error('Choose confirmed Circle members')
  }
  if (canonical.aPersonId === canonical.bPersonId) {
    throw new Error('Choose two different Circle members')
  }

  const byId = new Map(people.map((person) => [person.id, person]))
  const a = byId.get(canonical.aPersonId)
  const b = byId.get(canonical.bPersonId)
  if (a?.kind !== 'user' || b?.kind !== 'user') {
    throw new Error('Choose confirmed Circle members')
  }

  const duplicate = relations.some((relation) => {
    if (String(relation.kind) !== canonical.kind) return false
    const existingA = String(relation.aPersonId ?? '').trim()
    const existingB = String(relation.bPersonId ?? '').trim()
    const existing = canonicalEndpoints(String(relation.kind), existingA, existingB)
    return existing.aPersonId === canonical.aPersonId && existing.bPersonId === canonical.bPersonId
  })
  if (duplicate) throw new Error('That relationship already exists')

  if (wouldCreateAncestryCycle(canonical, relations)) {
    throw new Error('That relationship would create an ancestry loop')
  }

  return canonical
}

export function validateTreePosition(input: SaveTreePositionInput): SaveTreePositionInput {
  const personId = String(input.personId ?? '').trim()
  const x = Number(input.x)
  const y = Number(input.y)
  const valid = personId
    && Number.isFinite(x)
    && Number.isFinite(y)
    && x >= -TREE_COORDINATE_LIMIT
    && x <= TREE_COORDINATE_LIMIT
    && y >= -TREE_COORDINATE_LIMIT
    && y <= TREE_COORDINATE_LIMIT

  if (!valid) throw new Error('Choose a valid tree position')
  return { personId, x, y }
}
