import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { VaultDocumentSummary } from '../../../shared/desktopApi'
import type { PrivateAiClient, PrivateAiProgress, PrivateAiStatus } from '../../services/ai/PrivateAiClient'
import type { VaultClient } from '../../services/vault/VaultClient'
import { Vault } from './Vault'

const AiVault = Vault as unknown as ComponentType<{
  client: VaultClient
  privateAiClient: PrivateAiClient
}>

const baseAiStatus: PrivateAiStatus = {
  state: 'not_installed',
  ready: false,
  repairRequired: false,
  totalSizeBytes: 2_000_000_000,
  version: '2026.09.04',
  message: 'Private AI is optional',
}

function aiStatus(state: PrivateAiStatus['state']): PrivateAiStatus {
  return {
    ...baseAiStatus,
    state,
    ready: state === 'ready',
    repairRequired: state === 'repair_required',
    message: state === 'ready'
      ? 'Private AI is ready'
      : state === 'repair_required'
        ? 'Private AI needs repair'
        : state === 'failed'
          ? 'Private AI setup failed'
          : state === 'verifying'
            ? 'Verifying Private AI'
            : state === 'downloading'
              ? 'Downloading Private AI'
              : state === 'paused'
                ? 'Private AI setup paused'
                : 'Private AI is optional',
  }
}

function privateAiClient(
  status: PrivateAiStatus,
  overrides: Partial<PrivateAiClient> = {},
): PrivateAiClient {
  return {
    getStatus: vi.fn(async () => status),
    startSetup: vi.fn(async () => aiStatus('downloading')),
    pauseSetup: vi.fn(async () => aiStatus('paused')),
    repair: vi.fn(async () => aiStatus('ready')),
    onProgress: vi.fn(() => () => undefined),
    ...overrides,
  }
}

function vaultClient(documents: VaultDocumentSummary[] = [], overrides: Partial<VaultClient> = {}): VaultClient {
  return {
    listDocuments: vi.fn(async () => documents),
    chooseAndUploadDocuments: vi.fn(async () => ({ canceled: false, items: [] })),
    openDocument: vi.fn(async () => ({ success: true as const })),
    retryExtraction: vi.fn(async () => documents[0]!),
    retryIndexing: vi.fn(async () => ({ success: true as const })),
    deleteDocument: vi.fn(async () => ({ success: true as const })),
    onUploadProgress: vi.fn(() => () => undefined),
    ...overrides,
  }
}

describe('Vault Private AI setup and indexing UI', () => {
  it('shows the approved optional setup copy and starts setup without blocking uploads', async () => {
    const ai = privateAiClient(aiStatus('not_installed'))
    render(<AiVault client={vaultClient()} privateAiClient={ai} />)

    expect(await screen.findByText('Private AI is optional')).toBeInTheDocument()
    expect(screen.getByText(
      'Your documents are already stored privately. Set up Private AI to search them semantically and ask questions without sending them online.',
    )).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload documents' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Set up Private AI' }))
    await waitFor(() => expect(ai.startSetup).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Upload documents' })).toBeEnabled()
  })

  it.each([
    ['not_installed', 'Private AI is optional'],
    ['downloading', 'Downloading Private AI'],
    ['paused', 'Private AI setup paused'],
    ['verifying', 'Verifying Private AI'],
    ['ready', 'Private AI is ready'],
    ['repair_required', 'Private AI needs repair'],
    ['failed', 'Private AI setup failed'],
  ] as const)('renders %s while keeping Upload available', async (state, message) => {
    render(<AiVault client={vaultClient()} privateAiClient={privateAiClient(aiStatus(state))} />)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload documents' })).toBeEnabled()
  })

  it('shows safe download progress, pauses, and resumes through the Private AI client only', async () => {
    let listener: ((progress: PrivateAiProgress) => void) | null = null
    const pauseSetup = vi.fn(async () => aiStatus('paused'))
    const startSetup = vi.fn(async () => aiStatus('downloading'))
    const ai = privateAiClient(aiStatus('downloading'), {
      pauseSetup,
      startSetup,
      onProgress: vi.fn((next) => {
        listener = next
        return () => undefined
      }),
    })
    const { rerender } = render(<AiVault client={vaultClient()} privateAiClient={ai} />)

    await screen.findByText('Downloading Private AI')
    ;(listener as ((progress: PrivateAiProgress) => void) | null)?.({
      state: 'downloading',
      percent: 42,
      fileIndex: 2,
      fileCount: 3,
      fileName: 'Private AI component 2 of 3',
      bytesDownloaded: 420,
      totalSizeBytes: 1000,
      fileBytesDownloaded: 120,
      fileSizeBytes: 300,
      message: 'Downloading Private AI',
    })
    expect(await screen.findByText('42%')).toBeInTheDocument()
    expect(screen.getByText('Private AI component 2 of 3')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pause setup' }))
    await waitFor(() => expect(pauseSetup).toHaveBeenCalledTimes(1))

    rerender(<AiVault client={vaultClient()} privateAiClient={privateAiClient(aiStatus('paused'), { startSetup })} />)
    expect(await screen.findByRole('button', { name: 'Continue setup' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue setup' }))
    await waitFor(() => expect(startSetup).toHaveBeenCalled())
  })

  it('repairs repair-required and failed states through the safe repair action', async () => {
    for (const state of ['repair_required', 'failed'] as const) {
      const repair = vi.fn(async () => aiStatus('ready'))
      const ai = privateAiClient(aiStatus(state), { repair })
      const { unmount } = render(<AiVault client={vaultClient()} privateAiClient={ai} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Repair Private AI' }))
      await waitFor(() => expect(repair).toHaveBeenCalledTimes(1))
      unmount()
    }
  })

  it('unsubscribes from progress on unmount without pausing or canceling setup', async () => {
    const unsubscribe = vi.fn()
    const pauseSetup = vi.fn(async () => aiStatus('paused'))
    const ai = privateAiClient(aiStatus('downloading'), {
      pauseSetup,
      onProgress: vi.fn(() => unsubscribe),
    })
    const { unmount } = render(<AiVault client={vaultClient()} privateAiClient={ai} />)
    await screen.findByText('Downloading Private AI')

    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(pauseSetup).not.toHaveBeenCalled()
  })

  it('offers Retry indexing only for an extraction-ready document whose AI index failed', async () => {
    const failed: VaultDocumentSummary = {
      id: 44,
      fileName: 'Letters.docx',
      fileType: 'docx',
      sizeBytes: 4096,
      extractionStatus: 'ready',
      indexStatus: 'failed',
      wordCount: 120,
      preview: 'Family letters',
      issue: null,
      uploadedAt: 99,
    }
    const listDocuments = vi.fn().mockResolvedValueOnce([failed]).mockResolvedValueOnce([{ ...failed, indexStatus: 'indexing' }])
    const retryIndexing = vi.fn(async () => ({ success: true as const }))
    render(
      <AiVault
        client={vaultClient([failed], { listDocuments, retryIndexing })}
        privateAiClient={privateAiClient(aiStatus('ready'))}
      />,
    )

    await screen.findByText('Letters.docx')
    fireEvent.click(screen.getByRole('button', { name: 'Retry indexing Letters.docx' }))
    await waitFor(() => expect(retryIndexing).toHaveBeenCalledWith(44))
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(2))
  })
})
