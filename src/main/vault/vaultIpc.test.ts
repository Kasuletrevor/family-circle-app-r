import { describe, expect, it, vi } from 'vitest'
import { registerVaultIpc } from './vaultIpc'

function internalDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 12, localUserId: 7, fileName: 'Family History.pdf', fileType: 'pdf', mimeType: 'application/pdf',
    sizeBytes: 1234, sha256: 'private-hash', storedRelativePath: 'vault/users/7/documents/private.pdf',
    extractionStatus: 'ready', indexStatus: 'waiting_for_ai', wordCount: 88, preview: 'Family history preview',
    extractedText: 'full private family history', lastErrorCode: null, deleteStatus: 'active', uploadedAt: 99, updatedAt: 100,
    ...overrides,
  }
}

describe('registerVaultIpc', () => {
  it('registers only safe Vault channels and strips all private document fields', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) }
    const service = {
      listDocuments: vi.fn(async () => [internalDocument()]),
      chooseAndUploadDocuments: vi.fn(async (onProgress?: (payload: unknown) => void) => {
        onProgress?.({ fileIndex: 1, fileCount: 1, fileName: 'Family History.pdf', stage: 'extracting', percent: 70, sourcePath: 'C:/secret', sha256: 'secret' })
        return { canceled: false, items: [{ fileName: 'Family History.pdf', outcome: 'uploaded', documentId: 12, sourcePath: 'C:/secret' }] }
      }),
      openDocument: vi.fn(async () => ({ success: true as const })),
      retryExtraction: vi.fn(async () => internalDocument()),
      retryIndexing: vi.fn(async () => ({ success: true as const })),
      deleteDocument: vi.fn(async () => ({ success: true as const })),
    }

    registerVaultIpc(ipc, service as never)
    expect([...handlers.keys()]).toEqual(['vault:list', 'vault:choose-and-upload', 'vault:open', 'vault:retry-extraction', 'vault:retry-indexing', 'vault:delete'])

    const listed = await handlers.get('vault:list')?.({}, { localUserId: 999, path: 'C:/attacker', sha256: 'attacker' })
    expect(listed).toEqual([{
      id: 12, fileName: 'Family History.pdf', fileType: 'pdf', sizeBytes: 1234,
      extractionStatus: 'ready', indexStatus: 'waiting_for_ai', wordCount: 88,
      preview: 'Family history preview', issue: null, uploadedAt: 99,
    }])
    expect(JSON.stringify(listed)).not.toMatch(/localUserId|sha256|storedRelativePath|sourcePath|absolutePath|extractedText/)

    const send = vi.fn()
    const uploaded = await handlers.get('vault:choose-and-upload')?.({ sender: { send } }, { localUserId: 999, sourcePath: 'C:/attacker' })
    expect(send).toHaveBeenCalledWith('vault:upload-progress', { fileIndex: 1, fileCount: 1, fileName: 'Family History.pdf', stage: 'extracting', percent: 70 })
    expect(uploaded).toEqual({ canceled: false, items: [{ fileName: 'Family History.pdf', outcome: 'uploaded', documentId: 12 }] })
  })

  it('reconstructs only numeric documentId and discards renderer identity, path, and hash fields', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) } }
    const service = {
      listDocuments: vi.fn(async () => []),
      chooseAndUploadDocuments: vi.fn(async () => ({ canceled: true, items: [] })),
      openDocument: vi.fn(async () => ({ success: true as const })),
      retryExtraction: vi.fn(async () => internalDocument({ id: 21, lastErrorCode: 'extraction-failed' })),
      retryIndexing: vi.fn(async () => ({ success: true as const })),
      deleteDocument: vi.fn(async () => ({ success: true as const })),
    }
    registerVaultIpc(ipc, service as never)
    const malicious = { documentId: '21', localUserId: 999, path: 'C:/attacker', sourcePath: 'C:/attacker', sha256: 'attacker-hash' }

    await expect(handlers.get('vault:open')?.({}, malicious)).resolves.toEqual({ success: true })
    expect(service.openDocument).toHaveBeenCalledWith(21)
    const retried = await handlers.get('vault:retry-extraction')?.({}, malicious)
    expect(service.retryExtraction).toHaveBeenCalledWith(21)
    expect(JSON.stringify(retried)).not.toMatch(/localUserId|sha256|storedRelativePath|sourcePath|absolutePath|extractedText/)
    await expect(handlers.get('vault:retry-indexing')?.({}, malicious)).resolves.toEqual({ success: true })
    expect(service.retryIndexing).toHaveBeenCalledWith(21)
    await expect(handlers.get('vault:delete')?.({}, malicious)).resolves.toEqual({ success: true })
    expect(service.deleteDocument).toHaveBeenCalledWith(21)
  })
})
