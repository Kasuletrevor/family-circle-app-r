import type {
  AuthState,
  AuthUser,
  CircleContext,
  InvitationCheckResult,
  OnboardingNextAction,
  RegisterInput,
  ResetPasswordInput,
  SignInInput,
} from '../../shared/desktopApi'
import type { ClaimedInvitation } from '../circle/LegacyCircleAuthAdapter'
import { normalizeEmail } from './passwordPolicy'
import type { SessionStore } from './SessionStore'
import type { UserRepository } from './UserRepository'

export interface CircleAuthPort {
  checkInvitation(email: string): Promise<InvitationCheckResult>
  claimInvitation(input: { email: string; enteredPassword: string }): Promise<ClaimedInvitation>
  getMemberships(serverUserId: string): Promise<Array<{ id: string; name: string; role: string }>>
}

export interface RecoveryPort {
  request(email: string): Promise<{ success: true; message: string; expiresInMinutes: number }>
  reset(input: ResetPasswordInput): Promise<{ success: true }>
}

export function stateFor(user: AuthUser): AuthState {
  return user.mustChangePassword || !user.onboardingCompleted
    ? { status: 'onboarding', user }
    : { status: 'authenticated', user }
}

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionStore,
    private readonly recovery: RecoveryPort,
    private readonly circle: CircleAuthPort,
  ) {}

  async restore(): Promise<AuthState> {
    const user = await this.sessions.restore()
    return user ? stateFor(user) : { status: 'unauthenticated' }
  }

  getState(): Promise<AuthState> {
    return this.restore()
  }

  async signIn(input: SignInInput): Promise<AuthState> {
    const email = normalizeEmail(input.email)
    const local = await this.users.getRecordByEmail(email)

    if (local) {
      if (!await this.users.verifyPassword(local.user.id, input.password)) {
        throw new Error('Incorrect password.')
      }
      await this.sessions.save(local.user.id)
      return stateFor(local.user)
    }

    const claim = await this.circle.claimInvitation({
      email,
      enteredPassword: input.password,
    })
    const invited = await this.users.createInvitedUser({
      name: claim.name,
      email: claim.email,
      password: claim.verifiedTemporaryPassword,
      serverUserId: claim.serverUserId,
      invitation: claim.invitation,
    })
    await this.sessions.save(invited.id)
    return stateFor(invited)
  }

  checkInvitation(email: string): Promise<InvitationCheckResult> {
    return this.circle.checkInvitation(normalizeEmail(email))
  }

  async register(input: RegisterInput): Promise<AuthState> {
    const email = normalizeEmail(input.email)
    const invitation = await this.circle.checkInvitation(email)
    if (invitation.hasPendingInvite) {
      throw new Error('A family invitation already exists for this email. Sign in using the temporary password from your invitation email.')
    }

    const user = await this.users.createRegisteredUser({ ...input, email })
    await this.sessions.save(user.id)
    return stateFor(user)
  }

  async signOut(): Promise<{ success: true }> {
    await this.sessions.clear()
    return { success: true }
  }

  requestPasswordReset(email: string): Promise<{ success: true; message: string; expiresInMinutes: number }> {
    return this.recovery.request(normalizeEmail(email))
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ success: true }> {
    const result = await this.recovery.reset({ ...input, email: normalizeEmail(input.email) })
    await this.sessions.clear()
    return result
  }

  async setInitialPassword(newPassword: string): Promise<AuthState> {
    const current = await this.requireUser()
    if (!current.mustChangePassword) {
      throw new Error('A new invitation password is not required for this account')
    }
    const updated = await this.users.replacePassword(current.id, newPassword, { clearMustChangePassword: true })
    await this.sessions.save(updated.id)
    return stateFor(updated)
  }

  async updateProfile(name: string): Promise<AuthState> {
    const current = await this.requireUser()
    const updated = await this.users.updateProfile(current.id, name)
    await this.sessions.save(updated.id)
    return stateFor(updated)
  }

  async getCircleContext(): Promise<CircleContext> {
    const current = await this.requireUser()
    const record = await this.users.getRecordById(current.id)
    if (!record) throw new Error('Your setup session expired. Please sign in again.')

    if (current.accountOrigin === 'invited') {
      if (!record.serverUserId || !record.invitation) {
        throw new Error('Your invitation details are incomplete. Please sign in again.')
      }
      const groups = await this.circle.getMemberships(record.serverUserId)
      const expected = groups.some((group) => String(group.id) === String(record.invitation?.groupId))
      if (!expected) {
        throw new Error('Your account is ready, but the invited circle is not available yet. Check your connection and retry.')
      }
      return {
        accountOrigin: current.accountOrigin,
        invitation: record.invitation,
        groups,
      }
    }

    const groups = record.serverUserId
      ? await this.circle.getMemberships(record.serverUserId)
      : []
    return {
      accountOrigin: current.accountOrigin,
      invitation: null,
      groups,
    }
  }

  async complete(nextAction: OnboardingNextAction): Promise<AuthState> {
    const current = await this.requireUser()

    if (current.accountOrigin === 'invited') {
      if (nextAction !== 'joined-circle') {
        throw new Error('This onboarding action is not valid for this account')
      }
      await this.getCircleContext()
    } else if (nextAction !== 'home' && nextAction !== 'create-circle') {
      throw new Error('This onboarding action is not valid for this account')
    }

    const completed = await this.users.markOnboardingComplete(current.id)
    await this.sessions.save(completed.id)
    return stateFor(completed)
  }

  private async requireUser(): Promise<AuthUser> {
    const user = await this.sessions.restore()
    if (!user) throw new Error('Your setup session expired. Please sign in again.')
    return user
  }
}
