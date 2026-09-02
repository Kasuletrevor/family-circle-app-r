export type ServiceState = 'ready' | 'offline'

export type CircleSummary = {
  id: string
  name: string
  ownerName: string
  memberCount: number
  isActive: boolean
}

export type HomeMetrics = {
  members: number
  circles: number
  stories: number
  memories: number
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
  kind: 'spouse' | 'parent' | 'sibling'
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

export type HomeSnapshot = {
  state: ServiceState
  activeCircle: CircleSummary
  metrics: HomeMetrics
  upcoming: UpcomingItem[]
  activity: ActivityItem[]
  people: FamilyPerson[]
  relationships: FamilyRelationship[]
  selectedPersonId: string
}
