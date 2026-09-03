import type {
  CreateCircleInput,
  CreateCircleResult,
  InviteMemberInput,
  InviteMemberResult,
} from '../../../shared/desktopApi'
import type { CircleClient } from './CircleClient'
import type { CircleSummary, HomeSnapshot, ShellSnapshot } from './types'

const circles: CircleSummary[] = [
  { id: 'kasule-family', name: 'Kasule Family', ownerName: 'Trevor Kasule', role: 'Circle owner', memberCount: 12, isActive: true },
  { id: 'extended-family', name: 'Extended Family', ownerName: 'Trevor Kasule', role: 'Circle owner', memberCount: 18, isActive: false },
  { id: 'nambuti-family', name: 'Nambuti Family', ownerName: 'Grace Nambuti', role: 'Family member', memberCount: 9, isActive: false },
]

const homeSnapshot: HomeSnapshot = {
  state: 'ready',
  activeCircle: circles[0],
  metrics: { members: 12, circles: 3, stories: 28, memories: 142 },
  upcoming: [
    { id: 'upcoming-david', title: "David's Birthday", when: 'Tomorrow', kind: 'birthday' },
    { id: 'upcoming-mom', title: "Mom's Anniversary", when: 'In 5 days', kind: 'anniversary' },
    { id: 'upcoming-reunion', title: 'Family Reunion', when: 'In 23 days', kind: 'gathering' },
  ],
  activity: [
    { id: 'activity-jose', title: 'Jose accepted your invitation', detail: 'Kasule Family', when: '2 hours ago', kind: 'invitation' },
    { id: 'activity-relation', title: 'New relationship added', detail: 'Trevor is brother of David', when: 'Yesterday', kind: 'relationship' },
    { id: 'activity-story', title: 'Jane shared a story', detail: 'Childhood memories', when: '2 days ago', kind: 'story' },
    { id: 'activity-tree', title: 'Family tree updated', detail: 'Kasule Family', when: '3 days ago', kind: 'tree' },
  ],
  people: [
    { id: 'samuel', name: 'Samuel Kasule', role: 'Grandfather', birthYear: 1945, initials: 'SK', kind: 'member', generation: 0 },
    { id: 'grace', name: 'Grace Nambuti', role: 'Grandmother', birthYear: 1948, initials: 'GN', kind: 'member', generation: 0 },
    { id: 'john', name: 'John Kasule', role: 'Father', birthYear: 1972, initials: 'JK', kind: 'member', generation: 1 },
    { id: 'mary', name: 'Mary Kasule', role: 'Aunt', birthYear: 1975, initials: 'MK', kind: 'member', generation: 1 },
    { id: 'peter', name: 'Peter Kasule', role: 'Uncle', birthYear: 1978, initials: 'PK', kind: 'member', generation: 1 },
    { id: 'sarah', name: 'Sarah Nakato', role: 'Aunt', birthYear: 1980, initials: 'SN', kind: 'member', generation: 1 },
    {
      id: 'trevor',
      name: 'Trevor Kasule',
      role: 'You',
      birthYear: 1998,
      email: 'trevor@kasule.family',
      phone: '+256 700 123456',
      bio: 'Keeps family stories, relationships and private memories together.',
      initials: 'TK',
      kind: 'member',
      generation: 2,
    },
    { id: 'jane', name: 'Jane Kasule', role: 'Sister', birthYear: 2000, initials: 'JK', kind: 'member', generation: 2 },
    { id: 'david', name: 'David Kasule', role: 'Brother', birthYear: 2002, initials: 'DK', kind: 'member', generation: 2 },
    { id: 'emma', name: 'Emma Kasule', role: 'Cousin', birthYear: 2005, initials: 'EK', kind: 'member', generation: 2 },
  ],
  relationships: [
    { id: 'rel-samuel-grace', fromPersonId: 'samuel', toPersonId: 'grace', kind: 'spouse' },
    { id: 'rel-samuel-john', fromPersonId: 'samuel', toPersonId: 'john', kind: 'parent' },
    { id: 'rel-samuel-mary', fromPersonId: 'samuel', toPersonId: 'mary', kind: 'parent' },
    { id: 'rel-samuel-peter', fromPersonId: 'samuel', toPersonId: 'peter', kind: 'parent' },
    { id: 'rel-peter-sarah', fromPersonId: 'peter', toPersonId: 'sarah', kind: 'spouse' },
    { id: 'rel-john-trevor', fromPersonId: 'john', toPersonId: 'trevor', kind: 'parent' },
    { id: 'rel-john-jane', fromPersonId: 'john', toPersonId: 'jane', kind: 'parent' },
    { id: 'rel-peter-david', fromPersonId: 'peter', toPersonId: 'david', kind: 'parent' },
    { id: 'rel-peter-emma', fromPersonId: 'peter', toPersonId: 'emma', kind: 'parent' },
  ],
  selectedPersonId: 'trevor',
}

export class MockCircleClient implements CircleClient {
  private activeCircleId = 'kasule-family'

  async getHomeSnapshot(): Promise<HomeSnapshot> {
    return structuredClone(homeSnapshot)
  }

  async getMyCircles(): Promise<CircleSummary[]> {
    return structuredClone(circles.map((circle) => ({
      ...circle,
      isActive: circle.id === this.activeCircleId,
    })))
  }

  async getShellSnapshot(): Promise<ShellSnapshot> {
    return {
      activeCircleName: circles.find((circle) => circle.id === this.activeCircleId)?.name ?? null,
      unreadNotifications: 2,
    }
  }

  async selectCircle(circleId: string): Promise<void> {
    if (!circles.some((circle) => circle.id === circleId)) throw new Error('Circle was not found')
    this.activeCircleId = circleId
  }

  async createCircle(_input: CreateCircleInput): Promise<CreateCircleResult> {
    return { circleId: 'mock-created-circle' }
  }

  async inviteMember(_input: InviteMemberInput): Promise<InviteMemberResult> {
    return { outcome: 'sent' }
  }
}
