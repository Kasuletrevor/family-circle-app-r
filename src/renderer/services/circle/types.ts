export type ServiceState = 'ready' | 'offline'

export type CircleSummary = {
  id: string
  name: string
  ownerName?: string
  role?: string
  memberCount: number | null
  isActive: boolean
}

export type HomeMetrics = {
  members: number
  circles: number
  stories: number | null
  memories: number | null
}

export type FamilyPersonKind = 'member' | 'placeholder' | 'invited'

export type FamilyPerson = {
  id: string
  name: string
  role: string
  birthYear?: number
  email?: string
  phone?: string
  bio?: string
  initials: string
  kind: FamilyPersonKind
  generation: number
}

export type FamilyRelationship = {
  id: string
  fromPersonId: string
  toPersonId: string
  kind: string
}

export type UpcomingItem = {
  id: string
  title: string
  when: string
  kind: 'birthday' | 'anniversary' | 'gathering'
}

export type ActivityItem = {
  id: string
  title: string
  detail: string
  when: string
  kind: 'invitation' | 'relationship' | 'story' | 'tree'
}

export type HomeReadySnapshot = {
  state: ServiceState
  activeCircle: CircleSummary
  metrics: HomeMetrics
  upcoming: UpcomingItem[]
  activity: ActivityItem[]
  people: FamilyPerson[]
  relationships: FamilyRelationship[]
  selectedPersonId: string
}

export type HomeEmptySnapshot = {
  state: 'empty'
  reason: 'not-linked' | 'no-circles'
}

export type HomeSnapshot = HomeReadySnapshot | HomeEmptySnapshot
