import { describe, expect, it, vi } from 'vitest'
import type { VaultDocumentInternal } from './vaultModels'
import { VaultService } from './VaultService'

const USER = {
  id: 7,
  email: 'trevor@example.test',
  name: 'Trevor',
  accountOrigin: 'registered' as const,
  mustChangePassword: false,
  onboardingCompleted: true,
}

function storedDocument(): VaultDocumentInternal {
  return {
    id: 44,
    localUserId: USER.id,
    fileName: 'Family.txt',
    fileType: 'txt',
    mimeType: 'text/plain',
    sizeBytes: 20,
    sha256: 'hash',
    storedRelativePath: 'vault/users/7/documents/44.txt',
    extractionStatus: 'extracting',
    indexStatus: 'not_indexed',
    wordCount: 0,
    preview: null,
    extractedText: null,
    lastErrorCode: null,
    deleteStatus: 'active',
    uploadedAt: 1,
    updatedAt: 1,
  }
}

describe('VaultService indexing queue integration', () => {
  it('queues successful extraction for the restored user without waiting for indexing', async () => {
    const row = storedDocument()
    const indexQueue = { queueDocument: vi.fn() }
    const repository = {
      findByHash: vi.fn(async () => null),
      insertStoredDocument: vi.fn(async () => row),
      getByIdForUser: vi.fn(async () => row),
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
      picker: { chooseDocuments: vi.fn(async () => ['/selected/Family.txt']) },
      repository,
      fileStore: {
        copyIntoVault: vi.fn(async () => row.storedRelativePath),
        resolveOwnedPath: vi.fn(() => '/private/44.txt'),
        deleteOwnedFile: vi.fn(async () => undefined),
      },
      extractor: {
        extract: vi.fn(async () => ({ extractedText: 'family history', wordCount: 2, preview: 'family history' })),
      },
      opener: { openPath: vi.fn(async () => '') },
      validateDocument: vi.fn(async () => ({ fileType: 'txt' as const, mimeType: 'text/plain', extension: '.txt' as const, sizeBytes: 20 })),
      hashFile: vi.fn(async () => 'hash'),
      indexQueue,
    } as never)

    await expect(service.chooseAndUploadDocuments()).resolves.toMatchObject({
      canceled: false,
      items: [{ outcome: 'uploaded', documentId: 44 }],
    })
    expect(repository.markExtractionSuccess).toHaveBeenCalledTimes(1)
    expect(indexQueue.queueDocument).toHaveBeenCalledWith(USER.id, 44)
  })
})
