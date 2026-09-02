import type {
  AuthState,
  CircleContext,
  InvitationCheckResult,
  OnboardingNextAction,
  RegisterInput,
  ResetPasswordInput,
  SignInInput,
} from '../../shared/desktopApi'

export interface IpcHandleRegistrar {
  handle(channel: string, listener: (event: unknown, payload?: unknown) => unknown): void
}

export interface AuthIpcService {
  restore(): Promise<AuthState>
  signIn(input: SignInInput): Promise<AuthState>
  checkInvitation(email: string): Promise<InvitationCheckResult>
  register(input: RegisterInput): Promise<AuthState>
  signOut(): Promise<{ success: true }>
  requestPasswordReset(email: string): Promise<{ success: true; message: string; expiresInMinutes: number }>
  resetPassword(input: ResetPasswordInput): Promise<{ success: true }>
  getState(): Promise<AuthState>
  setInitialPassword(newPassword: string): Promise<AuthState>
  updateProfile(name: string): Promise<AuthState>
  getCircleContext(): Promise<CircleContext>
  complete(nextAction: OnboardingNextAction): Promise<AuthState>
}

export function registerAuthIpc(ipc: IpcHandleRegistrar, service: AuthIpcService): void {
  ipc.handle('auth:restore', () => service.restore())
  ipc.handle('auth:sign-in', (_event, payload) => service.signIn(payload as SignInInput))
  ipc.handle('auth:check-invitation', (_event, payload) => service.checkInvitation(String(payload ?? '')))
  ipc.handle('auth:register', (_event, payload) => service.register(payload as RegisterInput))
  ipc.handle('auth:sign-out', () => service.signOut())
  ipc.handle('auth:request-password-reset', (_event, payload) => service.requestPasswordReset(String(payload ?? '')))
  ipc.handle('auth:reset-password', (_event, payload) => service.resetPassword(payload as ResetPasswordInput))
  ipc.handle('onboarding:get-state', () => service.getState())
  ipc.handle('onboarding:set-initial-password', (_event, payload) => service.setInitialPassword(String(payload ?? '')))
  ipc.handle('onboarding:update-profile', (_event, payload) => service.updateProfile(String(payload ?? '')))
  ipc.handle('onboarding:get-circle-context', () => service.getCircleContext())
  ipc.handle('onboarding:complete', (_event, payload) => service.complete(payload as OnboardingNextAction))
}
