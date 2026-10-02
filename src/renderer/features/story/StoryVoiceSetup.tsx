import type { VoicePublicProgress, VoicePublicStatus } from '../../../shared/desktopApi'
import { PrivateAiSetupProgress } from '../private-ai/PrivateAiSetupProgress'
import { downloadSizeLabel } from '../private-ai/setupProgress'

/**
 * One-time offline voice setup, shown where it is needed: when someone presses
 * Record voice before the local transcription models are installed.
 */
export function StoryVoiceSetup({
  status,
  progress,
  busy,
  error,
  onSetup,
  onPause,
  onRepair,
}: {
  status: VoicePublicStatus
  progress: VoicePublicProgress | null
  busy: boolean
  error: string | null
  onSetup(): void
  onPause(): void
  onRepair(): void
}) {
  const sizeLabel = downloadSizeLabel(status)
  return (
    <section className="my-story__voice-setup" aria-label="Offline voice setup">
      <strong>Set up offline voice</strong>
      <p>Voice notes are transcribed on this computer, never online. This needs a one-time download first.</p>
      {sizeLabel ? <p className="my-story__voice-setup-size">{sizeLabel}</p> : null}
      <PrivateAiSetupProgress state={status.state} progress={progress} subject="offline voice" />
      <div className="my-story__voice-setup-actions">
        {status.state === 'not_installed' ? (
          <button type="button" className="my-story__primary" disabled={busy} onClick={onSetup}>Set up offline voice</button>
        ) : null}
        {status.state === 'paused' ? (
          <button type="button" className="my-story__primary" disabled={busy} onClick={onSetup}>Continue setup</button>
        ) : null}
        {status.state === 'downloading' ? (
          // Setup stays busy for the whole download, so pausing must remain possible.
          <button type="button" onClick={onPause}>Pause download</button>
        ) : null}
        {status.state === 'repair_required' || status.state === 'failed' ? (
          <button type="button" className="my-story__primary" disabled={busy} onClick={onRepair}>Repair offline voice</button>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
