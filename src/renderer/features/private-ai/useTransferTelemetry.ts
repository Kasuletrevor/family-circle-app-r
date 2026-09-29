import { useEffect, useRef, useState } from 'react'
import type { PrivateAiProgress } from '../../services/ai/PrivateAiClient'

const TRANSFER_SAMPLE_WINDOW_MS = 8_000
const TRANSFER_MIN_ELAPSED_MS = 500

type TransferSample = {
  atMs: number
  bytesDownloaded: number
}

export type TransferTelemetry = {
  bytesPerSecond: number
  etaSeconds: number
}

/** Download speed and time left, from a sliding window of recent progress samples. */
export function useTransferTelemetry(progress: PrivateAiProgress | null, now: () => number = Date.now): TransferTelemetry | null {
  const samples = useRef<TransferSample[]>([])
  const [telemetry, setTelemetry] = useState<TransferTelemetry | null>(null)

  useEffect(() => {
    if (
      !progress
      || progress.state !== 'downloading'
      || (progress.phase != null && progress.phase !== 'downloading')
      || progress.totalSizeBytes <= 0
      || progress.bytesDownloaded >= progress.totalSizeBytes
    ) {
      samples.current = []
      setTelemetry(null)
      return
    }

    const at = now()
    const previous = samples.current
    const last = previous[previous.length - 1]
    if (last && (progress.bytesDownloaded < last.bytesDownloaded || at < last.atMs)) {
      samples.current = [{ atMs: at, bytesDownloaded: progress.bytesDownloaded }]
      setTelemetry(null)
      return
    }
    if (last?.bytesDownloaded === progress.bytesDownloaded) return

    const window = [...previous, { atMs: at, bytesDownloaded: progress.bytesDownloaded }]
      .filter((sample) => at - sample.atMs <= TRANSFER_SAMPLE_WINDOW_MS)
    samples.current = window

    const first = window[0]
    const elapsedMs = first ? at - first.atMs : 0
    const transferredBytes = first ? progress.bytesDownloaded - first.bytesDownloaded : 0
    if (!first || elapsedMs < TRANSFER_MIN_ELAPSED_MS || transferredBytes <= 0) {
      setTelemetry(null)
      return
    }

    const bytesPerSecond = (transferredBytes * 1000) / elapsedMs
    const remainingBytes = Math.max(0, progress.totalSizeBytes - progress.bytesDownloaded)
    setTelemetry(Number.isFinite(bytesPerSecond) && bytesPerSecond > 0 && remainingBytes > 0
      ? { bytesPerSecond, etaSeconds: remainingBytes / bytesPerSecond }
      : null)
  }, [progress, now])

  return telemetry
}
