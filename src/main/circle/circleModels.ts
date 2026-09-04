export interface CircleGroupInternal {
  id: string
  name: string
  ownerId: string
  role: string
}

export interface CircleTreePersonInternal {
  id: string
  kind: 'user' | 'placeholder' | 'invite'
  userId: string | null
  invitationId?: string | null
  name: string
  email: string | null
  role: string
}

export interface CircleTreeRelationInternal {
  id: string
  kind: string
  aPersonId: string
  bPersonId: string
}

export interface CircleTreePositionInternal {
  personId: string
  x: number
  y: number
}

export interface CircleTreeInternal {
  group: { id: string; name: string; ownerId: string }
  people: CircleTreePersonInternal[]
  relations: CircleTreeRelationInternal[]
  positions: CircleTreePositionInternal[]
}
