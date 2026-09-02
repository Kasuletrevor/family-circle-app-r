import type {
  AuthState,
  CircleContext,
  InvitationCheckResult,
  OnboardingNextAction,
  RegisterInput,
  ResetPasswordInput,
  SignInInput,
} from '../../../shared/desktopApi'

export interface AuthClient {
  restore(): Promise<AuthState>
  signIn(input: SignInInput): Promise<AuthState>
  checkInvitation(email: string): Promise<InvitationCheckResult>
  register(input: RegisterInput): Promise<AuthState>
  signOut(): Promise<{ success: true }>
  requestPasswordReset(email: string): Promise<{ success: true; message: string; expiresInMinutes: number }>
  resetPassword(input: ResetPasswordInput): Promise<{ success: true }>
  getOnboardingState(): Promise<AuthState>
  setInitialPassword(newPassword: string): Promise<AuthState>
  updateProfile(name: string): Promise<AuthState>
  getCircleContext(): Promise<CircleContext>
  completeOnboarding(nextAction: OnboardingNextAction): Promise<AuthState>
}
