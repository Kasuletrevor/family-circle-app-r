import { describe, expect, it, vi } from 'vitest'
import type { VaultDocumentSummary, VaultUploadProgress } from '../../../shared/desktopApi'
import { DesktopVaultClient } from './DesktopVaultClient'

const document: VaultDocumentSummary = {
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

function operations(overrides: Record<string, unknown> = {}) {
  return {
    listDocuments: vi.fn(async () => [document]),
    chooseAndUploadDocuments: vi.fn(async () => ({ canceled: false, items: [] })),
    openDocument: vi.fn(async () => ({ success: true as const })),
    retryExtraction: vi.fn(async () => document),
    deleteDocument: vi.fn(async () => ({ success: true as const })),
    onUploadProgress: vi.fn((_listener: (progress: VaultUploadProgress) => void) => () => undefined),
    ...overrides,
  }
}

describe('DesktopVaultClient', () => {
  it('shares one in-flight authoritative list request across simultaneous consumers', async () => {
    let resolveList!: (documents: VaultDocumentSummary[]) => void
    const pending = new Promise<VaultDocumentSummary[]>((resolve) => { resolveList = resolve })
    const listDocuments = vi.fn(() => pending)
    const client = new DesktopVaultClient({ listDocuments })

    const first = client.listDocuments()
    const second = client.listDocuments()

    expect(first).toBe(second)
    expect(listDocuments).toHaveBeenCalledTimes(1)

    resolveList([document])
    await expect(first).resolves.toEqual([document])
  })

  it('delegates only numeric document ids and upload progress through the safe desktop Vault surface', async () => {
    const ops = operations()
    const client = new DesktopVaultClient(ops)
    const listener = vi.fn()

    await expect(client.openDocument(12)).resolves.toEqual({ success: true })
    await expect(client.retryExtraction(12)).resolves.toEqual(document)
    await expect(client.deleteDocument(12)).resolves.toEqual({ success: true })
    const unsubscribe = client.onUploadProgress(listener)

    expect(ops.openDocument).toHaveBeenCalledWith({ documentId: 12 })
    expect(ops.retryExtraction).toHaveBeenCalledWith({ documentId: 12 })
    expect(ops.deleteDocument).toHaveBeenCalledWith({ documentId: 12 })
    expect(ops.onUploadProgress).toHaveBeenCalledWith(listener)
    expect(unsubscribe).toEqual(expect.any(Function))
  })

  it('invalidates an in-flight list in finally after upload, retry, and failed delete', async () => {
    const pendingResolvers: Array<(documents: VaultDocumentSummary[]) => void> = []
    const listDocuments = vi.fn(() => new Promise<VaultDocumentSummary[]>((resolve) => pendingResolvers.push(resolve)))
    const chooseAndUploadDocuments = vi.fn(async () => ({ canceled: false, items: [] }))
    const retryExtraction = vi.fn(async () => document)
    const deleteDocument = vi.fn(async () => { throw new Error('disk busy') })
    const client = new DesktopVaultClient({
      listDocuments,
      chooseAndUploadDocuments,
      retryExtraction,
      deleteDocument,
    })

    const first = client.listDocuments()
    expect(listDocuments).toHaveBeenCalledTimes(1)

    await client.chooseAndUploadDocuments()
    const afterUpload = client.listDocuments()
    expect(listDocuments).toHaveBeenCalledTimes(2)

    await client.retryExtraction(12)
    const afterRetry = client.listDocuments()
    expect(listDocuments).toHaveBeenCalledTimes(3)

    await expect(client.deleteDocument(12)).rejects.toThrow('disk busy')
    const afterDeleteFailure = client.listDocuments()
    expect(listDocuments).toHaveBeenCalledTimes(4)

    pendingResolvers.forEach((resolve) => resolve([document]))
    await Promise.all([first, afterUpload, afterRetry, afterDeleteFailure])
  })
})
