import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VaultDocumentSummary, VaultUploadProgress } from '../../../shared/desktopApi'
import type { VaultClient } from '../../services/vault/VaultClient'
import { Vault } from './Vault'

const baseDocument: VaultDocumentSummary = {
  id: 12,
  fileName: 'Family History.pdf',
  fileType: 'pdf',
  sizeBytes: 1536,
  extractionStatus: 'ready',
  indexStatus: 'waiting_for_ai',
  wordCount: 88,
  preview: 'Family history preview',
  issue: null,
  uploadedAt: 99,
}

function document(overrides: Partial<VaultDocumentSummary> = {}): VaultDocumentSummary {
  return { ...baseDocument, ...overrides }
}

function client(overrides: Partial<VaultClient> = {}): VaultClient {
  return {
    listDocuments: vi.fn(async () => []),
    chooseAndUploadDocuments: vi.fn(async () => ({ canceled: false, items: [] })),
    openDocument: vi.fn(async () => ({ success: true as const })),
    retryExtraction: vi.fn(async () => baseDocument),
    deleteDocument: vi.fn(async () => ({ success: true as const })),
    onUploadProgress: vi.fn(() => () => undefined),
    ...overrides,
  }
}

describe('Vault', () => {
  it('shows the private local empty state without requiring AI', async () => {
    render(<Vault client={client()} />)

    expect(screen.getByRole('heading', { name: 'Vault' })).toBeInTheDocument()
    expect(screen.getByText('Your private documents stay on this computer.')).toBeInTheDocument()
    expect(await screen.findByText('No documents in your Vault yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload documents' })).toBeEnabled()
  })

  it('uploads through the client and then re-reads the authoritative document list', async () => {
    const listDocuments = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([baseDocument])
    const chooseAndUploadDocuments = vi.fn(async () => ({
      canceled: false,
      items: [{ fileName: baseDocument.fileName, outcome: 'uploaded' as const, documentId: baseDocument.id }],
    }))
    const vaultClient = client({ listDocuments, chooseAndUploadDocuments })
    render(<Vault client={vaultClient} />)

    await screen.findByText('No documents in your Vault yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Upload documents' }))

    expect(await screen.findByText('Family History.pdf')).toBeInTheDocument()
    expect(chooseAndUploadDocuments).toHaveBeenCalledTimes(1)
    expect(listDocuments).toHaveBeenCalledTimes(2)
  })

  it('renders file type, size, word count, and local AI readiness status', async () => {
    render(<Vault client={client({ listDocuments: vi.fn(async () => [baseDocument]) })} />)

    await screen.findByText('Family History.pdf')
    expect(screen.getByText('PDF')).toBeInTheDocument()
    expect(screen.getByText('1.5 KB')).toBeInTheDocument()
    expect(screen.getByText('88 words')).toBeInTheDocument()
    expect(screen.getByText('Ready for Private AI')).toBeInTheDocument()
  })

  it('shows only safe per-file upload progress', async () => {
    let progressListener: ((progress: VaultUploadProgress) => void) | null = null
    let resolveUpload!: () => void
    const pendingUpload = new Promise<void>((resolve) => { resolveUpload = resolve })
    const vaultClient = client({
      chooseAndUploadDocuments: vi.fn(async () => {
        await pendingUpload
        return { canceled: false, items: [] }
      }),
      onUploadProgress: vi.fn((listener) => {
        progressListener = listener
        return () => undefined
      }),
    })
    render(<Vault client={vaultClient} />)

    await screen.findByText('No documents in your Vault yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Upload documents' }))
    ;(progressListener as ((progress: VaultUploadProgress) => void) | null)?.({
      fileIndex: 1,
      fileCount: 2,
      fileName: 'Family History.pdf',
      stage: 'extracting',
      percent: 70,
    })

    expect(await screen.findByText(/Family History\.pdf/)).toBeInTheDocument()
    expect(screen.getByText(/Extracting/)).toBeInTheDocument()
    expect(screen.getByText(/70%/)).toBeInTheDocument()
    resolveUpload()
  })

  it('shows Retry extraction only for extraction failure, not AI indexing failure', async () => {
    const docs = [
      document({ id: 12, extractionStatus: 'failed', indexStatus: 'not_indexed', issue: 'extraction-failed' }),
      document({ id: 13, fileName: 'Letters.docx', fileType: 'docx', indexStatus: 'failed', issue: null }),
    ]
    render(<Vault client={client({ listDocuments: vi.fn(async () => docs) })} />)

    await screen.findByText('Letters.docx')
    const retryButtons = screen.getAllByRole('button', { name: /Retry extraction/i })
    expect(retryButtons).toHaveLength(1)
    expect(retryButtons[0]).toHaveAccessibleName('Retry extraction Family History.pdf')
    expect(screen.getByText('AI indexing failed')).toBeInTheDocument()
  })

  it('opens a document only through the Vault client', async () => {
    const openDocument = vi.fn(async () => ({ success: true as const }))
    render(<Vault client={client({ listDocuments: vi.fn(async () => [baseDocument]), openDocument })} />)

    await screen.findByText('Family History.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Open Family History.pdf' }))

    await waitFor(() => expect(openDocument).toHaveBeenCalledWith(12))
  })

  it('confirms before deleting and re-reads only after confirmed success', async () => {
    const listDocuments = vi.fn()
      .mockResolvedValueOnce([baseDocument])
      .mockResolvedValueOnce([])
    const deleteDocument = vi.fn(async () => ({ success: true as const }))
    render(<Vault client={client({ listDocuments, deleteDocument })} />)

    await screen.findByText('Family History.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Family History.pdf' }))
    expect(deleteDocument).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }))
    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith(12))
    expect(await screen.findByText('No documents in your Vault yet.')).toBeInTheDocument()
    expect(listDocuments).toHaveBeenCalledTimes(2)
  })

  it('keeps a document visible when delete fails instead of reporting optimistic success', async () => {
    const deleteDocument = vi.fn(async () => { throw new Error('disk busy') })
    const listDocuments = vi.fn(async () => [baseDocument])
    render(<Vault client={client({ listDocuments, deleteDocument })} />)

    await screen.findByText('Family History.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Family History.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Family History.pdf could not be deleted. Please try again.')
    expect(screen.getByText('Family History.pdf')).toBeInTheDocument()
  })

  it('never disables Upload just because extracted documents are waiting for Private AI', async () => {
    render(<Vault client={client({ listDocuments: vi.fn(async () => [baseDocument]) })} />)

    await screen.findByText('Ready for Private AI')
    expect(screen.getByRole('button', { name: 'Upload documents' })).toBeEnabled()
  })
})
