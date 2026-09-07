import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VaultDocumentSummary } from '../../../shared/desktopApi'
import type { VaultClient } from '../../services/vault/VaultClient'
import { AskVault } from './AskVault'

const indexed: VaultDocumentSummary = {
  id: 4,
  fileName: 'Family History.pdf',
  fileType: 'pdf',
  sizeBytes: 1000,
  extractionStatus: 'ready',
  indexStatus: 'indexed',
  wordCount: 100,
  preview: 'Family history',
  issue: null,
  uploadedAt: 1,
}

const waiting: VaultDocumentSummary = { ...indexed, id: 5, fileName: 'Letters.txt', fileType: 'txt', indexStatus: 'waiting_for_ai' }

function client(overrides: Partial<VaultClient> = {}): VaultClient {
  return {
    listDocuments: vi.fn(async () => [indexed, waiting]),
    chooseAndUploadDocuments: vi.fn(async () => ({ canceled: true, items: [] })),
    openDocument: vi.fn(async () => ({ success: true as const })),
    retryExtraction: vi.fn(async () => indexed),
    retryIndexing: vi.fn(async () => ({ success: true as const })),
    deleteDocument: vi.fn(async () => ({ success: true as const })),
    ask: vi.fn(async () => ({ answer: '', sources: [] })),
    onUploadProgress: vi.fn(() => () => undefined),
    ...overrides,
  }
}

describe('AskVault', () => {
  it('shows a private local composer and guards an empty question', async () => {
    const ask = vi.fn()
    render(<AskVault client={client({ ask })} />)

    expect(screen.getByRole('heading', { name: 'Ask your Vault' })).toBeInTheDocument()
    expect(screen.getByText('Ask questions using only your indexed private documents on this computer.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Question' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask Private AI' })).toBeDisabled()
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks across all indexed documents and renders the answer with safe sources', async () => {
    const ask = vi.fn(async () => ({
      answer: 'Grandmother was born in Jinja.',
      sources: [{ documentId: 4, fileName: 'Family History.pdf', excerpt: 'She was born in Jinja.' }],
    }))
    render(<AskVault client={client({ ask })} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Where was grandmother born?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Private AI' }))

    expect(screen.getByRole('button', { name: 'Thinking locally…' })).toBeDisabled()
    expect(await screen.findByText('Grandmother was born in Jinja.')).toBeInTheDocument()
    expect(screen.getByText('Family History.pdf')).toBeInTheDocument()
    expect(screen.getByText('She was born in Jinja.')).toBeInTheDocument()
    expect(ask).toHaveBeenCalledWith('Where was grandmother born?', { type: 'all' })
  })

  it('selected mode lists only indexed documents and submits selected numeric ids', async () => {
    const ask = vi.fn(async () => ({ answer: 'Answer', sources: [] }))
    render(<AskVault client={client({ ask })} />)

    await screen.findByText('All indexed documents')
    fireEvent.click(screen.getByRole('radio', { name: 'Choose documents' }))
    expect(await screen.findByRole('checkbox', { name: 'Family History.pdf' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Letters.txt' })).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Family History.pdf' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Who?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Private AI' }))

    await waitFor(() => expect(ask).toHaveBeenCalledWith('Who?', { type: 'documents', documentIds: [4] }))
  })

  it('shows a safe user-facing error without filesystem or model detail', async () => {
    const ask = vi.fn(async () => { throw new Error('C:/secret/model.gguf at 127.0.0.1:8080') })
    render(<AskVault client={client({ ask })} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Question?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Private AI' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Private AI could not answer from your Vault. Please try again.')
    expect(alert.textContent).not.toMatch(/C:\\|gguf|127\.0\.0\.1|8080/)
  })
})
