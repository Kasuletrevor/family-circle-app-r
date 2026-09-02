import { useState } from 'react'
import type { AuthState, CircleContext, OnboardingNextAction } from '../../../shared/desktopApi'
import { BrandMark } from '../../design-system/BrandMark'
import type { AuthClient } from '../../services/auth/AuthClient'
import { CircleStep } from './CircleStep'
import { PasswordStep } from './PasswordStep'
import { ProfileStep } from './ProfileStep'
import { ReadyStep } from './ReadyStep'
import './Onboarding.css'

type Step = 'password' | 'profile' | 'circle' | 'ready'

interface OnboardingProps {
  state: Extract<AuthState, { status: 'onboarding' }>
  client: AuthClient
  onStateChange(state: AuthState): void
}

export function Onboarding({ state, client, onStateChange }: OnboardingProps) {
  const [currentState, setCurrentState] = useState(state)
  const [step, setStep] = useState<Step>(state.user.mustChangePassword ? 'password' : 'profile')
  const [circleContext, setCircleContext] = useState<CircleContext | null>(null)
  const [nextAction, setNextAction] = useState<OnboardingNextAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function keepOnboarding(next: AuthState): Extract<AuthState, { status: 'onboarding' }> {
    if (next.status !== 'onboarding') throw new Error('Setup state changed unexpectedly. Please reopen Family Circle.')
    setCurrentState(next)
    return next
  }

  async function saveInitialPassword(password: string) {
    setError(null)
    setBusy(true)
    try {
      keepOnboarding(await client.setInitialPassword(password))
      setStep('profile')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not secure your account. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function loadCircle() {
    setError(null)
    setBusy(true)
    try {
      const context = await client.getCircleContext()
      if (currentState.user.accountOrigin === 'invited' && !context.invitation) {
        throw new Error('Your expected family Circle could not be confirmed.')
      }
      setCircleContext(context)
    } catch (reason) {
      setCircleContext(null)
      setError(reason instanceof Error ? reason.message : 'Could not confirm your family Circle. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function saveProfile(name: string) {
    setError(null)
    setBusy(true)
    try {
      const next = keepOnboarding(await client.updateProfile(name))
      setStep('circle')
      if (next.user.accountOrigin === 'invited') {
        setBusy(true)
        try {
          const context = await client.getCircleContext()
          if (!context.invitation) throw new Error('Your expected family Circle could not be confirmed.')
          setCircleContext(context)
        } catch (reason) {
          setCircleContext(null)
          setError(reason instanceof Error ? reason.message : 'Could not confirm your family Circle. Please try again.')
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save your profile. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function chooseNext(action: OnboardingNextAction) {
    setError(null)
    setNextAction(action)
    setStep('ready')
  }

  async function complete() {
    if (!nextAction) return
    setError(null)
    setBusy(true)
    try {
      onStateChange(await client.completeOnboarding(nextAction))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not finish setup. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const stepNumber = step === 'password' ? 1 : step === 'profile' ? 2 : step === 'circle' ? 3 : 4

  return (
    <main className="onboarding-screen">
      <aside className="onboarding-sidebar">
        <BrandMark />
        <div className="onboarding-sidebar__copy">
          <span className="auth-eyebrow">Family Circle setup</span>
          <h2>A few deliberate steps before you enter.</h2>
          <p>Security first, then your family-visible profile, then a confirmed or chosen Circle path.</p>
        </div>
        <ol className="onboarding-progress" aria-label="Onboarding progress">
          {['Secure your account', 'Your profile', 'Your family circle', 'Ready'].map((label, index) => {
            const number = index + 1
            return (
              <li key={label} className={number === stepNumber ? 'is-active' : number < stepNumber ? 'is-complete' : ''}>
                <span>{number}</span>
                <strong>{number} · {label}</strong>
              </li>
            )
          })}
        </ol>
        <div className="onboarding-account">
          <span>Signed in as</span>
          <strong>{currentState.user.email}</strong>
        </div>
      </aside>

      <section className="onboarding-content">
        {step === 'password' && (
          <PasswordStep busy={busy} error={error} onSubmit={saveInitialPassword} />
        )}
        {step === 'profile' && (
          <ProfileStep
            initialName={currentState.user.name || ''}
            busy={busy}
            error={error}
            onSubmit={saveProfile}
          />
        )}
        {step === 'circle' && (
          <CircleStep
            accountOrigin={currentState.user.accountOrigin}
            profileName={currentState.user.name || currentState.user.email}
            context={circleContext}
            loading={busy && !circleContext && !error}
            error={error}
            onRetry={() => void loadCircle()}
            onContinue={chooseNext}
          />
        )}
        {step === 'ready' && nextAction && (
          <ReadyStep
            nextAction={nextAction}
            circleName={circleContext?.invitation?.groupName}
            busy={busy}
            error={error}
            onComplete={complete}
          />
        )}
      </section>
    </main>
  )
}
