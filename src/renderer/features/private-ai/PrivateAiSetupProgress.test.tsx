import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrivateAiProgress, PrivateAiStatus } from '../../services/ai/PrivateAiClient'
import { PrivateAiSetupProgress } from './PrivateAiSetupProgress'
import { downloadSizeLabel } from './setupProgress'

const MB = 1024 * 1024

function status(overrides: Partial<PrivateAiStatus>): PrivateAiStatus {
  return {
    state: 'not_installed',
    ready: false,
    repairRequired: false,
    totalSizeBytes: 651 * MB,
    downloadSizeBytes: 651 * MB,
    version: '1.3.0',
    message: null,
    ...overrides,
  }
}

function progress(overrides: Partial<PrivateAiProgress>): PrivateAiProgress {
  return {
    state: 'downloading',
    phase: 'downloading',
    percent: 0,
    fileIndex: 1,
    fileCount: 1,
    fileName: 'Private AI component 1 of 1',
    bytesDownloaded: 0,
    totalSizeBytes: 19 * MB,
    fileBytesDownloaded: 0,
    fileSizeBytes: 19 * MB,
    message: 'Downloading Private AI',
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('downloadSizeLabel', () => {
  it('describes a first-time setup as the full one-time download', () => {
    expect(downloadSizeLabel(status({}))).toBe('One-time download · about 651 MB')
  })

  it('tells the user a repair downloads only what is missing', () => {
    expect(downloadSizeLabel(status({ state: 'repair_required', repairRequired: true, downloadSizeBytes: 18.3 * MB })))
      .toBe('Repair downloads about 18 MB')
    expect(downloadSizeLabel(status({ state: 'repair_required', repairRequired: true, downloadSizeBytes: 0 })))
      .toBe('Repair re-checks the installed files; nothing needs downloading')
  })

  it('shows what is left after a pause or a partial download', () => {
    expect(downloadSizeLabel(status({ state: 'paused', downloadSizeBytes: 400 * MB }))).toBe('About 400 MB left to download')
    expect(downloadSizeLabel(status({ downloadSizeBytes: 250 * MB })))
      .toBe('About 250 MB left to download (651 MB in total)')
  })

  it('falls back to the full size for statuses without a download size', () => {
    expect(downloadSizeLabel(status({ state: 'repair_required', repairRequired: true, downloadSizeBytes: undefined })))
      .toBe('Repair downloads about 651 MB')
    expect(downloadSizeLabel(status({ state: 'ready', ready: true }))).toBeNull()
  })
})

describe('PrivateAiSetupProgress', () => {
  it('shows the step, percent and bytes of only what is being downloaded', () => {
    render(
      <PrivateAiSetupProgress
        state="downloading"
        progress={progress({ fileIndex: 2, fileCount: 3, percent: 40, bytesDownloaded: 260 * MB, totalSizeBytes: 651 * MB })}
      />,
    )

    expect(screen.getByText('Downloading part 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText(/260\.0 MB of 651\.0 MB/)).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Private AI setup progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '40')
  })

  it('names the steps that have no byte count and shows an indeterminate bar', () => {
    const { rerender } = render(<PrivateAiSetupProgress state="verifying" progress={progress({ state: 'verifying', phase: 'checking' })} />)
    expect(screen.getByText('Checking installed files…')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
    expect(screen.queryByText(/ of /)).not.toBeInTheDocument()

    rerender(<PrivateAiSetupProgress state="verifying" progress={progress({ state: 'verifying', phase: 'extracting' })} />)
    expect(screen.getByText('Preparing the AI engine…')).toBeInTheDocument()

    rerender(<PrivateAiSetupProgress state="verifying" progress={progress({ state: 'verifying', phase: 'verifying' })} />)
    expect(screen.getByText('Verifying download…')).toBeInTheDocument()

    rerender(<PrivateAiSetupProgress state="downloading" progress={null} />)
    expect(screen.getByText('Starting download…')).toBeInTheDocument()
  })

  it('renders nothing when setup is not running', () => {
    const { container, rerender } = render(<PrivateAiSetupProgress state="paused" progress={progress({})} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<PrivateAiSetupProgress state="ready" progress={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows download speed and time left once enough progress has been sampled', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const { rerender } = render(
      <PrivateAiSetupProgress state="downloading" progress={progress({ bytesDownloaded: 1 * MB, percent: 5 })} />,
    )
    expect(screen.queryByText(/MB\/s/)).not.toBeInTheDocument()

    vi.setSystemTime(2_000)
    rerender(<PrivateAiSetupProgress state="downloading" progress={progress({ bytesDownloaded: 2 * MB, percent: 11 })} />)

    // 1 MB in 2 s is 0.5 MB/s; 17 MB left is about 34 s.
    expect(screen.getByText(/0\.5 MB\/s · about 34 sec left/)).toBeInTheDocument()
  })

  it('suggests a coffee break only for large downloads', () => {
    const { rerender } = render(
      <PrivateAiSetupProgress state="downloading" progress={progress({ percent: 3, bytesDownloaded: 20 * MB, totalSizeBytes: 651 * MB })} />,
    )
    expect(screen.getByText('Take a break, get some coffee — this will take several minutes.')).toBeInTheDocument()

    rerender(<PrivateAiSetupProgress state="downloading" progress={progress({ percent: 40, bytesDownloaded: 7 * MB, totalSizeBytes: 18 * MB })} />)
    expect(screen.queryByText(/get some coffee/)).not.toBeInTheDocument()
  })
})
