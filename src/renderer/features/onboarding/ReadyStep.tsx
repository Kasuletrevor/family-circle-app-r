import type { OnboardingNextAction } from '../../../shared/desktopApi'

interface ReadyStepProps {
  nextAction: OnboardingNextAction
  circleName?: string | null
  busy: boolean
  error: string | null
  onComplete(): Promise<void>
}

export function ReadyStep({ nextAction, circleName, busy, error, onComplete }: ReadyStepProps) {
  const invited = nextAction === 'joined-circle'
  const createCircle = nextAction === 'create-circle'
  const buttonLabel = invited
    ? 'Enter my family circle'
    : createCircle
      ? 'Create my first circle'
      : 'Explore Family Circle'

  return (
    <section className="onboarding-step onboarding-step--ready">
      <div className="onboarding-ready-mark" aria-hidden="true">✓</div>
      <div className="onboarding-heading onboarding-heading--center">
        <span className="auth-eyebrow">Step 4 of 4</span>
        <h1>Ready</h1>
        <p>
          {invited && <>Your account is secured and your membership in {circleName || 'your family Circle'} is confirmed.</>}
          {createCircle && 'Your private workspace is ready. Next you can create your first family Circle.'}
          {nextAction === 'home' && 'Your private workspace is ready. Explore first and create or join Circles when you choose.'}
        </p>
      </div>
      {error && <div className="auth-alert" role="alert">{error}</div>}
      <button className="auth-primary" type="button" disabled={busy} onClick={() => void onComplete()}>
        {busy ? 'Opening…' : buttonLabel}
      </button>
    </section>
  )
}
