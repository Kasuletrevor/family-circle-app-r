import type {
  AuthState,
  CircleContext,
  CircleDetails,
  CircleListItem,
  CircleOverview,
  CreateCircleInput,
  CreateCircleResult,
  DesktopApi,
  InvitationCheckResult,
  InviteMemberInput,
  InviteMemberResult,
  OnboardingNextAction,
  RegisterInput,
  ResendInvitationResult,
  ResetPasswordInput,
  SignInInput,
} from '../shared/desktopApi'

type DesktopChannel =
  | 'app:get-version'
  | 'app:get-platform'
  | 'auth:restore'
  | 'auth:sign-in'
  | 'auth:check-invitation'
  | 'auth:register'
  | 'auth:sign-out'
  | 'auth:request-password-reset'
  | 'auth:reset-password'
  | 'onboarding:get-state'
  | 'onboarding:set-initial-password'
  | 'onboarding:update-profile'
  | 'onboarding:get-circle-context'
  | 'onboarding:complete'
  | 'circle:get-overview'
  | 'circle:get-my-circles'
  | 'circle:get-details'
  | 'circle:select'
  | 'circle:create'
  | 'circle:invite-member'
  | 'circle:resend-invitation'
  | 'circle:cancel-invitation'
  | 'circle:remove-member'
  | 'circle:leave'

type Invoke = (channel: DesktopChannel, payload?: unknown) => Promise<unknown>

export function createDesktopApi(invoke: Invoke): DesktopApi {
  return {
    app: {
      async getVersion() {
        return String(await invoke('app:get-version'))
      },
      async getPlatform() {
        return String(await invoke('app:get-platform')) as NodeJS.Platform
      },
    },
    auth: {
      restore() {
        return invoke('auth:restore') as Promise<AuthState>
      },
      signIn(input: SignInInput) {
        return invoke('auth:sign-in', input) as Promise<AuthState>
      },
      checkInvitation(email: string) {
        return invoke('auth:check-invitation', email) as Promise<InvitationCheckResult>
      },
      register(input: RegisterInput) {
        return invoke('auth:register', input) as Promise<AuthState>
      },
      signOut() {
        return invoke('auth:sign-out') as Promise<{ success: true }>
      },
      requestPasswordReset(email: string) {
        return invoke('auth:request-password-reset', email) as Promise<{
          success: true
          message: string
          expiresInMinutes: number
        }>
      },
      resetPassword(input: ResetPasswordInput) {
        return invoke('auth:reset-password', input) as Promise<{ success: true }>
      },
    },
    onboarding: {
      getState() {
        return invoke('onboarding:get-state') as Promise<AuthState>
      },
      setInitialPassword(newPassword: string) {
        return invoke('onboarding:set-initial-password', newPassword) as Promise<AuthState>
      },
      updateProfile(name: string) {
        return invoke('onboarding:update-profile', name) as Promise<AuthState>
      },
      getCircleContext() {
        return invoke('onboarding:get-circle-context') as Promise<CircleContext>
      },
      complete(nextAction: OnboardingNextAction) {
        return invoke('onboarding:complete', nextAction) as Promise<AuthState>
      },
    },
    circle: {
      getOverview() {
        return invoke('circle:get-overview') as Promise<CircleOverview>
      },
      getMyCircles() {
        return invoke('circle:get-my-circles') as Promise<CircleListItem[]>
      },
      getCircleDetails() {
        return invoke('circle:get-details') as Promise<CircleDetails | null>
      },
      selectCircle(circleId: string) {
        return invoke('circle:select', circleId) as Promise<{ success: true }>
      },
      createCircle(input: CreateCircleInput) {
        return invoke('circle:create', input) as Promise<CreateCircleResult>
      },
      inviteMember(input: InviteMemberInput) {
        return invoke('circle:invite-member', input) as Promise<InviteMemberResult>
      },
      resendInvitation(input: { personId: string }) {
        return invoke('circle:resend-invitation', input) as Promise<ResendInvitationResult>
      },
      cancelInvitation(input: { personId: string }) {
        return invoke('circle:cancel-invitation', input) as Promise<{ success: true }>
      },
      removeMember(input: { personId: string }) {
        return invoke('circle:remove-member', input) as Promise<{ success: true }>
      },
      leaveCircle() {
        return invoke('circle:leave') as Promise<{ success: true }>
      },
    },
  }
}
