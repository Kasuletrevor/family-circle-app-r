import type { CircleContext, OnboardingNextAction } from '../../../shared/desktopApi'

interface CircleStepProps {
  accountOrigin: 'registered' | 'invited' | 'existing'
  profileName: string
  context: CircleContext | null
  loading: boolean
  error: string | null
  onRetry(): void
  onContinue(nextAction: OnboardingNextAction): void
}

export function CircleStep({
  accountOrigin,
  profileName,
  context,
  loading,
  error,
  onRetry,
  onContinue,
}: CircleStepProps) {
  const invited = accountOrigin === 'invited'

  return (
    <section className="onboarding-step" aria-live="polite">
      <div className="onboarding-heading">
        <span className="auth-eyebrow">Step 3 of 4</span>
        <h1>Your family circle</h1>
        <p>
          {invited
            ? 'We confirm the family Circle from your invitation before you enter the shared workspace.'
            : 'You can create your first Circle next, or explore the private workspace before inviting anyone.'}
        </p>
      </div>

      <div className="onboarding-profile-saved">
        <span>Profile saved for</span>
        <strong>{profileName}</strong>
      </div>

      {invited && loading && <div className="onboarding-loading">Confirming your family Circle…</div>}
      {invited && error && (
        <div className="onboarding-retry">
          <div className="auth-alert" role="alert">{error}</div>
          <button className="auth-secondary" type="button" onClick={onRetry}>Try Circle again</button>
        </div>
      )}
      {invited && context?.invitation && !error && (
        <>
          <div className="onboarding-circle-card">
            <span className="onboarding-circle-card__label">Confirmed invitation</span>
            <strong>{context.invitation.groupName}</strong>
            <span>{context.invitation.role}</span>
          </div>
          <button className="auth-primary" type="button" onClick={() => onContinue('joined-circle')}>Continue</button>
        </>
      )}

      {!invited && (
        <div className="onboarding-choice-grid">
          <button className="onboarding-choice" type="button" onClick={() => onContinue('create-circle')}>
            <strong>Create Circle</strong>
            <span>Start a new family space after setup.</span>
          </button>
          <button className="onboarding-choice" type="button" onClick={() => onContinue('home')}>
            <strong>Explore First</strong>
            <span>Open the private workspace and create a Circle later.</span>
          </button>
        </div>
      )}
    </section>
  )
}
