import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import type { InsertStoredDocumentInput, VaultDocumentInternal, VaultExtractionSuccess } from './vaultModels'
import { registerVaultIpc } from './vaultIpc'
import { VaultService } from './VaultService'

const USER: AuthUser = {
  id: 7,
  email: 'vault-owner@example.test',
  name: 'Vault Owner',
  accountOrigin: 'registered',
  mustChangePassword: false,
  onboardingCompleted: true,
}

function document(overrides: Partial<VaultDocumentInternal> = {}): VaultDocumentInternal {
  return {
    id: 1,
    localUserId: USER.id,
    fileName: 'Family History.pdf',
    fileType: 'pdf',
    mimeType: 'application/pdf',
    sizeBytes: 120,
    sha256: 'old-private-hash',
    storedRelativePath: 'vault/users/7/documents/old-private.pdf',
    extractionStatus: 'ready',
    indexStatus: 'waiting_for_ai',
    wordCount: 4,
    preview: 'Safe short preview',
    extractedText: 'FULL PRIVATE EXTRACTED TEXT MUST STAY IN MAIN',
    lastErrorCode: null,
    deleteStatus: 'active',
    uploadedAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function makeSecurityHarness(options: { selectedPaths?: string[] } = {}) {
  const documents: VaultDocumentInternal[] = []
  const deletedFiles: string[] = []
  const copiedFiles: string[] = []
  let nextId = 100

  const repository = {
    async findByHash(localUserId: number, sha256: string) {
      return documents.find((row) => row.localUserId === localUserId && row.sha256 === sha256) ?? null
    },
    async insertStoredDocument(input: InsertStoredDocumentInput) {
      const created = document({
        id: nextId++,
        localUserId: input.localUserId,
        fileName: input.fileName,
        fileType: input.fileType,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        storedRelativePath: input.storedRelativePath,
        extractionStatus: input.extractionStatus ?? 'pending',
        indexStatus: input.indexStatus ?? 'not_indexed',
        wordCount: 0,
        preview: null,
        extractedText: null,
        lastErrorCode: null,
        deleteStatus: 'active',
        uploadedAt: 2,
        updatedAt: 2,
      })
      documents.push(created)
      return created
    },
    async getByIdForUser(localUserId: number, documentId: number) {
      return documents.find((row) => row.localUserId === localUserId && row.id === documentId) ?? null
    },
    async listByUser(localUserId: number) {
      return documents.filter((row) => row.localUserId === localUserId && row.deleteStatus === 'active')
    },
    async listPendingDeletions(localUserId: number) {
      return documents.filter((row) => row.localUserId === localUserId && row.deleteStatus === 'pending')
    },
    async markExtractionStarted(localUserId: number, documentId: number) {
      const row = documents.find((candidate) => candidate.localUserId === localUserId && candidate.id === documentId)
      if (!row) throw new Error('not found')
      row.extractionStatus = 'extracting'
      row.indexStatus = 'not_indexed'
      row.lastErrorCode = null
    },
    async markExtractionSuccess(localUserId: number, documentId: number, update: VaultExtractionSuccess) {
      const row = documents.find((candidate) => candidate.localUserId === localUserId && candidate.id === documentId)
      if (!row) throw new Error('not found')
      row.extractionStatus = 'ready'
      row.indexStatus = 'waiting_for_ai'
      row.wordCount = update.wordCount
      row.preview = update.preview
      row.extractedText = update.extractedText
      row.lastErrorCode = null
    },
    async markExtractionFailure(localUserId: number, documentId: number, errorCode: string) {
      const row = documents.find((candidate) => candidate.localUserId === localUserId && candidate.id === documentId)
      if (!row) throw new Error('not found')
      row.extractionStatus = 'failed'
      row.indexStatus = 'not_indexed'
      row.lastErrorCode = errorCode
    },
    async markDeletePending(localUserId: number, documentId: number) {
      const row = documents.find((candidate) => candidate.localUserId === localUserId && candidate.id === documentId)
      if (!row) throw new Error('not found')
      row.deleteStatus = 'pending'
    },
    async markDeleteActive(localUserId: number, documentId: number, errorCode: string | null = null) {
      const row = documents.find((candidate) => candidate.localUserId === localUserId && candidate.id === documentId)
      if (!row) throw new Error('not found')
      row.deleteStatus = 'active'
      row.lastErrorCode = errorCode
    },
    async deleteByIdForUser(localUserId: number, documentId: number) {
      const index = documents.findIndex((row) => row.localUserId === localUserId && row.id === documentId)
      if (index < 0) return false
      documents.splice(index, 1)
      return true
    },
  }

  const fileStore = {
    async copyIntoVault(localUserId: number, _sourcePath: string, extension: string) {
      const stored = `vault/users/${localUserId}/documents/new-private-${copiedFiles.length + 1}${extension}`
      copiedFiles.push(stored)
      return stored
    },
    resolveOwnedPath(localUserId: number, storedRelativePath: string) {
      if (!storedRelativePath.startsWith(`vault/users/${localUserId}/documents/`)) throw new Error('not owned')
      return `/private/${storedRelativePath}`
    },
    async deleteOwnedFile(localUserId: number, storedRelativePath: string) {
      if (!storedRelativePath.startsWith(`vault/users/${localUserId}/documents/`)) throw new Error('not owned')
      deletedFiles.push(storedRelativePath)
      // Missing files are intentionally treated as already deleted, matching rm(..., { force: true }).
    },
  }

  const service = new VaultService({
    session: { restore: vi.fn(async () => USER) },
    picker: { chooseDocuments: vi.fn(async () => options.selectedPaths ?? []) },
    repository,
    fileStore,
    extractor: {
      extract: vi.fn(async () => ({
        extractedText: 'New private extracted text',
        wordCount: 4,
        preview: 'New private extracted text',
      })),
    },
    opener: { openPath: vi.fn(async () => '') },
    validateDocument: vi.fn(async () => ({
      fileType: 'pdf' as const,
      mimeType: 'application/pdf',
      extension: '.pdf' as const,
      sizeBytes: 130,
    })),
    hashFile: vi.fn(async () => 'new-private-hash'),
  })

  return { service, documents, deletedFiles, copiedFiles }
}

describe('Vault merge-blocking security regressions', () => {
  it('cannot open/retry/delete another user by guessed id', async () => {
    for (const operation of ['open', 'retry', 'delete'] as const) {
      const { service, documents } = makeSecurityHarness()
      documents.push(document({
        id: 77,
        localUserId: 8,
        storedRelativePath: 'vault/users/8/documents/private.pdf',
      }))

      const result = operation === 'open'
        ? service.openDocument(77)
        : operation === 'retry'
          ? service.retryExtraction(77)
          : service.deleteDocument(77)

      await expect(result).rejects.toMatchObject({ code: 'not-found' })
    }
  })

  it('never returns private path/hash/full text in summary/result/progress', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const sentProgress: unknown[] = []
    const internal = document()
    const ipc = {
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler)
      },
    }
    const service = {
      listDocuments: vi.fn(async () => [internal]),
      chooseAndUploadDocuments: vi.fn(async (onProgress?: (event: unknown) => void) => {
        onProgress?.({
          fileIndex: 1,
          fileCount: 1,
          fileName: 'Family History.pdf',
          stage: 'saving',
          percent: 40,
          sourcePath: 'C:/secret/source/Family History.pdf',
          sha256: 'progress-private-hash',
        })
        return {
          canceled: false,
          items: [{
            fileName: 'Family History.pdf',
            outcome: 'uploaded',
            documentId: internal.id,
            sourcePath: 'C:/secret/source/Family History.pdf',
            sha256: 'result-private-hash',
          }],
        }
      }),
      openDocument: vi.fn(async () => ({ success: true as const })),
      retryExtraction: vi.fn(async () => internal),
      deleteDocument: vi.fn(async () => ({ success: true as const })),
    }

    registerVaultIpc(ipc, service as never)
    const event = { sender: { send: (_channel: string, payload: unknown) => sentProgress.push(payload) } }
    const listResult = await handlers.get('vault:list')?.(event)
    const uploadResult = await handlers.get('vault:choose-and-upload')?.(event)
    const retryResult = await handlers.get('vault:retry-extraction')?.(event, { documentId: internal.id })

    const serialized = JSON.stringify({ listResult, uploadResult, retryResult, sentProgress })
    for (const forbidden of [
      internal.storedRelativePath,
      internal.sha256,
      internal.extractedText!,
      'C:/secret/source/Family History.pdf',
      'progress-private-hash',
      'result-private-hash',
      'storedRelativePath',
      'sourcePath',
      'extractedText',
      'sha256',
      'localUserId',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('recovers pending deletion with missing source', async () => {
    const { service, documents, deletedFiles } = makeSecurityHarness()
    const pending = document({ id: 31, deleteStatus: 'pending' })
    const keep = document({ id: 32, fileName: 'Keep.pdf', sha256: 'keep-hash' })
    documents.push(pending, keep)

    const rows = await service.listDocuments()

    expect(deletedFiles).toEqual([pending.storedRelativePath])
    expect(documents.map((row) => row.id)).toEqual([32])
    expect(rows.map((row) => row.id)).toEqual([32])
  })

  it('never calls the Circle adapter or remote network during local Vault ingestion', async () => {
    const remoteCall = vi.fn(async () => { throw new Error('network must not be used') })
    vi.stubGlobal('fetch', remoteCall)
    try {
      const { service } = makeSecurityHarness({ selectedPaths: ['/selected/Family History.pdf'] })
      await expect(service.chooseAndUploadDocuments()).resolves.toMatchObject({
        canceled: false,
        items: [{ outcome: 'uploaded' }],
      })
      expect(remoteCall).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('same-name upload does not replace old content', async () => {
    const { service, documents, copiedFiles } = makeSecurityHarness({
      selectedPaths: ['/selected/Family History.pdf'],
    })
    const old = document({
      id: 41,
      fileName: 'Family History.pdf',
      sha256: 'old-private-hash',
      storedRelativePath: 'vault/users/7/documents/original.pdf',
      extractedText: 'Original private family record',
    })
    documents.push(old)

    const result = await service.chooseAndUploadDocuments()

    expect(result.items).toMatchObject([{ outcome: 'uploaded', fileName: 'Family History (2).pdf' }])
    expect(documents).toHaveLength(2)
    expect(documents[0]).toMatchObject({
      id: 41,
      fileName: 'Family History.pdf',
      sha256: 'old-private-hash',
      storedRelativePath: 'vault/users/7/documents/original.pdf',
      extractedText: 'Original private family record',
    })
    expect(documents[1]).toMatchObject({
      fileName: 'Family History (2).pdf',
      sha256: 'new-private-hash',
      storedRelativePath: copiedFiles[0],
    })
    expect(documents[1]?.storedRelativePath).not.toBe(old.storedRelativePath)
  })
})
