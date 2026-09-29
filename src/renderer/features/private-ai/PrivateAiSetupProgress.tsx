import type { PrivateAiProgress, PrivateAiState } from '../../services/ai/PrivateAiClient'
import { describeSetupStep, formatBytes, formatEta } from './setupProgress'
import { useTransferTelemetry } from './useTransferTelemetry'
import './PrivateAiSetupProgress.css'

interface PrivateAiSetupProgressProps {
  state: PrivateAiState | undefined
  progress: PrivateAiProgress | null
}

/** Shared Private AI setup/repair progress for Settings and the Vault page. */
export function PrivateAiSetupProgress({ state, progress }: PrivateAiSetupProgressProps) {
  const telemetry = useTransferTelemetry(progress)
  if (state !== 'downloading' && state !== 'verifying') return null

  const step = describeSetupStep(progress, state)
  const determinate = step.kind === 'determinate'

  return (
    <div className="private-ai-progress" role="status" aria-live="polite">
      <div className="private-ai-progress__copy">
        <span>{step.label}</span>
        {determinate ? <strong>{step.percent}%</strong> : null}
      </div>
      <div
        className={`private-ai-progress__meter${determinate ? '' : ' private-ai-progress__meter--indeterminate'}`}
        role="progressbar"
        aria-label="Private AI setup progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? step.percent : undefined}
        aria-valuetext={step.label}
      >
        <span style={determinate ? { width: `${step.percent}%` } : undefined} />
      </div>
      {determinate ? (
        <small className="private-ai-progress__detail">
          {formatBytes(step.bytesDownloaded)} of {formatBytes(step.totalBytes)}
          {telemetry
            ? ` · ${(telemetry.bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s · about ${formatEta(telemetry.etaSeconds)} left`
            : null}
        </small>
      ) : null}
    </div>
  )
}
