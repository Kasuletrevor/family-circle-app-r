import type { CircleTreePersonRecord, CircleTreeRelationRecord } from '../../../shared/desktopApi'

function personName(personId: string, people: CircleTreePersonRecord[]): string {
  return people.find((person) => person.id === personId)?.name?.trim() || 'Family member'
}

function readableKind(kindInput: string): string {
  const kind = String(kindInput ?? '').trim()
  if (!kind) return 'family'
  return kind.replaceAll('_', ' ').replace(/\s+/g, ' ')
}

function titleCase(value: string): string {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

export function relationshipSentence(
  relation: CircleTreeRelationRecord,
  people: CircleTreePersonRecord[],
): string {
  const a = personName(relation.aPersonId, people)
  const b = personName(relation.bPersonId, people)

  switch (relation.kind) {
    case 'mother': return `${a} is the mother of ${b}`
    case 'father': return `${a} is the father of ${b}`
    case 'guardian': return `${a} is the guardian of ${b}`
    case 'grandparent': return `${a} is the grandparent of ${b}`
    case 'spouse': return `${a} is the spouse / partner of ${b}`
    case 'sibling': return `${a} is the sibling of ${b}`
    case 'aunt_uncle': return `${a} is the aunt / uncle of ${b}`
    case 'cousin': return `${a} is the cousin of ${b}`
    default: return `${a} and ${b} have a ${readableKind(relation.kind)} relationship`
  }
}

function labelForEndpoint(
  relation: CircleTreeRelationRecord,
  personId: string,
  otherName: string,
): string {
  const isA = relation.aPersonId === personId

  switch (relation.kind) {
    case 'mother': return isA ? `Mother of ${otherName}` : `Child of ${otherName}`
    case 'father': return isA ? `Father of ${otherName}` : `Child of ${otherName}`
    case 'guardian': return isA ? `Guardian of ${otherName}` : `Under guardianship of ${otherName}`
    case 'grandparent': return isA ? `Grandparent of ${otherName}` : `Grandchild of ${otherName}`
    case 'aunt_uncle': return isA ? `Aunt / uncle of ${otherName}` : `Niece / nephew of ${otherName}`
    case 'spouse': return `Spouse / partner of ${otherName}`
    case 'sibling': return `Sibling of ${otherName}`
    case 'cousin': return `Cousin of ${otherName}`
    default: return `${titleCase(readableKind(relation.kind))} relationship with ${otherName}`
  }
}

export function relationshipsForPerson(
  personId: string,
  relations: CircleTreeRelationRecord[],
  people: CircleTreePersonRecord[],
): string[] {
  return relations.flatMap((relation) => {
    if (relation.aPersonId !== personId && relation.bPersonId !== personId) return []
    const otherPersonId = relation.aPersonId === personId ? relation.bPersonId : relation.aPersonId
    return [labelForEndpoint(relation, personId, personName(otherPersonId, people))]
  })
}
