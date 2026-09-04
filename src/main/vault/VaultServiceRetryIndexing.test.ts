import { describe, expect, it, vi } from 'vitest'
import { VaultService } from './VaultService'

const USER = {
  id: 7,
  email: 'trevor@example.test',
  name: 'Trevor',
  accountOrigin: 'registered' as const,
  mustChangePassword: false,
  onboardingCompleted: true,
}

function document(localUserId = USER.id) {
  return {
    id: 44,
    localUserId,
    fileName: 'Family.txt',
    fileType: 'txt' as const,
    mimeType: 'text/plain',
    sizeBytes: 20,
    sha256: 'hash',
    storedRelativePath: `vault/users/${localUserId}/documents/44.txt`,
    extractionStatus: 'ready' as const,
    indexStatus: 'failed' as const,
    wordCount: 2,
    preview: 'family history',
    extractedText: 'family history',
    lastErrorCode: 'indexing-failed',
    deleteStatus: 'active' as const,
    uploadedAt: 1,
    updatedAt: 1,
  }
}

describe('VaultService retry indexing', () => {
  it('restores the protected user and passes only that user plus document id to the indexer', async () => {
    const indexDocument = vi.fn(async () => undefined)
    const repository = {
      findByHash: vi.fn(async () => null),
      insertStoredDocument: vi.fn(async () => document()),
      getByIdForUser: vi.fn(async (localUserId: number, documentId: number) => document(localUserId).id === documentId ? document(localUserId) : null),
      listByUser: vi.fn(async () => []),
      listPendingDeletions: vi.fn(async () => []),
      markExtractionStarted: vi.fn(async () => undefined),
      markExtractionSuccess: vi.fn(async () => undefined),
      markExtractionFailure: vi.fn(async () => undefined),
      markDeletePending: vi.fn(async () => undefined),
      markDeleteActive: vi.fn(async () => undefined),
      deleteByIdForUser: vi.fn(async () => true),
    }
    const service = new VaultService({
      session: { restore: vi.fn(async () => USER) },
      picker: { chooseDocuments: vi.fn(async () => []) },
      repository,
      fileStore: {
        copyIntoVault: vi.fn(async () => ''),
        resolveOwnedPath: vi.fn(() => ''),
        deleteOwnedFile: vi.fn(async () => undefined),
      },
      extractor: { extract: vi.fn(async () => ({ extractedText: '', wordCount: 0, preview: '' })) },
      opener: { openPath: vi.fn(async () => '') },
      indexQueue: { queueDocument: vi.fn(), indexDocument },
    } as never)

    const retryIndexing = (service as unknown as { retryIndexing(documentId: number): Promise<{ success: true }> }).retryIndexing
    await expect(retryIndexing.call(service, 44)).resolves.toEqual({ success: true })
    expect(repository.getByIdForUser).toHaveBeenCalledWith(USER.id, 44)
    expect(indexDocument).toHaveBeenCalledWith(USER.id, 44)
  })
})
