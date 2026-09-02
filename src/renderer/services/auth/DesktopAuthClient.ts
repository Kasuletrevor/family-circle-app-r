import type { DesktopApi } from '../../../shared/desktopApi'
import type { AuthClient } from './AuthClient'

export class DesktopAuthClient implements AuthClient {
  constructor(private readonly desktop: DesktopApi) {}

  restore() {
    return this.desktop.auth.restore()
  }

  signIn(input: Parameters<AuthClient['signIn']>[0]) {
    return this.desktop.auth.signIn(input)
  }

  checkInvitation(email: string) {
    return this.desktop.auth.checkInvitation(email)
  }

  register(input: Parameters<AuthClient['register']>[0]) {
    return this.desktop.auth.register(input)
  }

  signOut() {
    return this.desktop.auth.signOut()
  }

  requestPasswordReset(email: string) {
    return this.desktop.auth.requestPasswordReset(email)
  }

  resetPassword(input: Parameters<AuthClient['resetPassword']>[0]) {
    return this.desktop.auth.resetPassword(input)
  }

  getOnboardingState() {
    return this.desktop.onboarding.getState()
  }

  setInitialPassword(newPassword: string) {
    return this.desktop.onboarding.setInitialPassword(newPassword)
  }

  updateProfile(name: string) {
    return this.desktop.onboarding.updateProfile(name)
  }

  getCircleContext() {
    return this.desktop.onboarding.getCircleContext()
  }

  completeOnboarding(nextAction: Parameters<AuthClient['completeOnboarding']>[0]) {
    return this.desktop.onboarding.complete(nextAction)
  }
}
