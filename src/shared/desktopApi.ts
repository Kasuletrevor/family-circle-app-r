export type AccountOrigin = 'registered' | 'invited' | 'existing'
export type OnboardingNextAction = 'create-circle' | 'home' | 'joined-circle'

export const INVITATION_FAMILY_ROLES = [
  'Family member',
  'Parent',
  'Child',
  'Spouse / Partner',
  'Sibling',
  'Grandparent',
  'Grandchild',
  'Guardian / Caregiver',
] as const

export type InvitationFamilyRole = typeof INVITATION_FAMILY_ROLES[number]

export interface AuthUser {
  id: number
  email: string
  name: string | null
  accountOrigin: AccountOrigin
  mustChangePassword: boolean
  onboardingCompleted: boolean
}

export type AuthState =
  | { status: 'unauthenticated' }
  | { status: 'onboarding'; user: AuthUser }
  | { status: 'authenticated'; user: AuthUser }

export interface SignInInput {
  email: string
  password: string
}

export interface RegisterInput {
  name: string
  email: string
  password: string
}

export interface ResetPasswordInput {
  email: string
  code: string
  newPassword: string
}

export interface InvitationCheckResult {
  hasPendingInvite: boolean
  groupName: string | null
  role: string | null
}

export interface CircleContext {
  accountOrigin: AccountOrigin
  invitation: null | { groupId: string; groupName: string; role: string }
  groups: Array<{ id: string; name: string; role: string }>
}

export interface CircleGroupRecord {
  id: string
  name: string
  role: string
}

export interface CircleTreePersonRecord {
  id: string
  kind: 'user' | 'placeholder' | 'invite'
  name: string
  email: string | null
  role: string
}

export interface CircleTreeRelationRecord {
  id: string
  kind: string
  aPersonId: string
  bPersonId: string
}

export interface CircleTreePositionRecord {
  personId: string
  x: number
  y: number
}

export interface CircleTreeRecord {
  group: { id: string; name: string }
  people: CircleTreePersonRecord[]
  relations: CircleTreeRelationRecord[]
  positions: CircleTreePositionRecord[]
}

export interface CircleNotificationRecord {
  id: string
  type: string
  title: string
  message: string
  groupId: string | null
  groupName: string | null
  createdAt: number | null
  read: boolean
}

export interface CircleListItem {
  id: string
  name: string
  role: string
  memberCount: number
  isActive: boolean
}

export interface CreateCircleInput {
  name: string
}

export interface CreateCircleResult {
  circleId: string
}

export interface InviteMemberInput {
  circleId: string
  email: string
  role: InvitationFamilyRole
}

export interface InviteMemberResult {
  outcome: 'sent' | 'already-pending' | 'already-member' | 'delivery-failed'
}

export interface CircleDetailsMember {
  personId: string
  name: string
  email: string | null
  role: string
  isViewer: boolean
  isOwner: boolean
}

export interface CircleDetailsInvitation {
  personId: string
  email: string
  role: string
  status: 'pending'
}

export interface CircleDetails {
  circle: {
    id: string
    name: string
    role: string
    memberCount: number
    pendingInvitationCount: number
  }
  members: CircleDetailsMember[]
  invitations: CircleDetailsInvitation[]
}

export interface ResendInvitationResult {
  outcome: 'sent' | 'delivery-failed'
}

export type CircleOverview =
  | {
      status: 'empty'
      reason: 'not-linked' | 'no-circles'
      circles: CircleGroupRecord[]
      activeCircleId: null
      viewerPersonId: null
      tree: null
      notifications: CircleNotificationRecord[]
    }
  | {
      status: 'ready'
      circles: CircleGroupRecord[]
      activeCircleId: string
      viewerPersonId: string | null
      tree: CircleTreeRecord
      notifications: CircleNotificationRecord[]
    }

export interface DesktopApi {
  app: {
    getVersion(): Promise<string>
    getPlatform(): Promise<NodeJS.Platform>
  }
  auth: {
    restore(): Promise<AuthState>
    signIn(input: SignInInput): Promise<AuthState>
    checkInvitation(email: string): Promise<InvitationCheckResult>
    register(input: RegisterInput): Promise<AuthState>
    signOut(): Promise<{ success: true }>
    requestPasswordReset(email: string): Promise<{ success: true; message: string; expiresInMinutes: number }>
    resetPassword(input: ResetPasswordInput): Promise<{ success: true }>
  }
  onboarding: {
    getState(): Promise<AuthState>
    setInitialPassword(newPassword: string): Promise<AuthState>
    updateProfile(name: string): Promise<AuthState>
    getCircleContext(): Promise<CircleContext>
    complete(nextAction: OnboardingNextAction): Promise<AuthState>
  }
  circle: {
    getOverview(): Promise<CircleOverview>
    getMyCircles(): Promise<CircleListItem[]>
    selectCircle(circleId: string): Promise<{ success: true }>
    createCircle(input: CreateCircleInput): Promise<CreateCircleResult>
    inviteMember(input: InviteMemberInput): Promise<InviteMemberResult>
  }
}
