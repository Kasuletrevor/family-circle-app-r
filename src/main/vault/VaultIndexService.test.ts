import { describe, expect, it, vi } from 'vitest'
import type { VaultDocumentInternal } from './vaultModels'
import { EMBEDDING_MODEL_ID, INDEX_VERSION, VaultIndexService } from './VaultIndexService'

function document(overrides: Partial<VaultDocumentInternal> = {}): VaultDocumentInternal {
  return {
    id: 1,
    localUserId: 7,
    fileName: 'Family History.txt',
    fileType: 'txt',
    mimeType: 'text/plain',
    sizeBytes: 100,
    sha256: 'hash',
    storedRelativePath: 'vault/users/7/documents/history.txt',
    extractionStatus: 'ready',
    indexStatus: 'waiting_for_ai',
    wordCount: 8,
    preview: 'Family history preview',
    extractedText: 'A family history with enough private text to index.',
    lastErrorCode: null,
    deleteStatus: 'active',
    uploadedAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function makeHarness(rows: VaultDocumentInternal[] = [document()], options: { aiReady?: boolean } = {}) {
  const documents = {
    rows,
    getByIdForUser: vi.fn(async (localUserId: number, documentId: number) =>
      rows.find((row) => row.localUserId === localUserId && row.id === documentId) ?? null),
    listByUser: vi.fn(async (localUserId: number) => rows.filter((row) => row.localUserId === localUserId && row.deleteStatus === 'active')),
    markIndexing: vi.fn(async (localUserId: number, documentId: number) => {
      const row = rows.find((candidate) => candidate.localUserId === localUserId && candidate.id === documentId)
      if (!row) throw new Error('missing')
      row.indexStatus = 'indexing'
      row.lastErrorCode = null
    }),
    markIndexFailure: vi.fn(async (localUserId: number, documentId: number, code: string) => {
      const row = rows.find((candidate) => candidate.localUserId === localUserId && candidate.id === documentId)
      if (!row) throw new Error('missing')
      row.indexStatus = 'failed'
      row.lastErrorCode = code
    }),
  }
  const chunks = {
    replaceDocumentIndex: vi.fn(async (localUserId: number, documentId: number) => {
      const row = rows.find((candidate) => candidate.localUserId === localUserId && candidate.id === documentId)
      if (row) {
        row.indexStatus = 'indexed'
        row.lastErrorCode = null
      }
    }),
  }
  const runtime = {
    ensureEmbeddingRuntime: vi.fn(async () => true),
  }
  let embedSequence = 0
  const nomic = {
    embedDocument: vi.fn(async () => new Float32Array([++embedSequence, 0.5])),
  }
  const assets = {
    getStatus: vi.fn(async () => ({ state: options.aiReady === false ? 'not_installed' : 'ready' })),
  }
  const service = new VaultIndexService({ documents, chunks, runtime, nomic, assets })
  return { service, documents, chunks, runtime, nomic, assets, rows }
}

describe('VaultIndexService', () => {
  it('requires owned extraction-ready document', async () => {
    const mineNotReady = document({ id: 2, extractionStatus: 'failed', extractedText: null, indexStatus: 'not_indexed' })
    const theirs = document({ id: 3, localUserId: 8, storedRelativePath: 'vault/users/8/documents/theirs.txt' })
    const { service, documents, runtime } = makeHarness([mineNotReady, theirs])

    await expect(service.indexDocument(7, 3)).rejects.toMatchObject({ code: 'not-found' })
    await expect(service.indexDocument(7, 2)).rejects.toMatchObject({ code: 'not-ready' })
    expect(documents.markIndexing).not.toHaveBeenCalled()
    expect(runtime.ensureEmbeddingRuntime).not.toHaveBeenCalled()
  })

  it('starts only embedding runtime', async () => {
    const { service, runtime } = makeHarness()

    await service.indexDocument(7, 1)

    expect(runtime.ensureEmbeddingRuntime).toHaveBeenCalledTimes(1)
    expect(Object.keys(runtime)).toEqual(['ensureEmbeddingRuntime'])
  })

  it('marks indexing before embedding', async () => {
    const { service, documents, nomic } = makeHarness()
    const order: string[] = []
    documents.markIndexing.mockImplementationOnce(async () => { order.push('indexing') })
    nomic.embedDocument.mockImplementationOnce(async () => {
      order.push('embedding')
      return new Float32Array([1, 2])
    })

    await service.indexDocument(7, 1)

    expect(order.slice(0, 2)).toEqual(['indexing', 'embedding'])
  })

  it('embeds each deterministic chunk once', async () => {
    const longText = 'x'.repeat(2200)
    const { service, nomic } = makeHarness([document({ extractedText: longText })])

    await service.indexDocument(7, 1)

    expect(nomic.embedDocument).toHaveBeenCalledTimes(3)
    expect(nomic.embedDocument.mock.calls.every((call) => typeof call[0] === 'string' && call[0].length > 0)).toBe(true)
  })

  it('persists model/version Float32 vectors', async () => {
    const { service, chunks } = makeHarness()

    await service.indexDocument(7, 1)

    expect(chunks.replaceDocumentIndex).toHaveBeenCalledTimes(1)
    const [localUserId, documentId, indexedChunks, model, version] = chunks.replaceDocumentIndex.mock.calls[0]!
    expect(localUserId).toBe(7)
    expect(documentId).toBe(1)
    expect(model).toBe(EMBEDDING_MODEL_ID)
    expect(version).toBe(INDEX_VERSION)
    expect(indexedChunks[0]?.embedding).toBeInstanceOf(Float32Array)
  })

  it('marks failed without harming source/text', async () => {
    const row = document()
    const originalText = row.extractedText
    const originalPath = row.storedRelativePath
    const { service, documents, nomic } = makeHarness([row])
    nomic.embedDocument.mockRejectedValueOnce(new Error('internal model detail'))

    await expect(service.indexDocument(7, 1)).rejects.toMatchObject({ code: 'indexing-failed' })

    expect(documents.markIndexFailure).toHaveBeenCalledWith(7, 1, 'indexing-failed')
    expect(row).toMatchObject({
      extractionStatus: 'ready',
      indexStatus: 'failed',
      extractedText: originalText,
      storedRelativePath: originalPath,
      lastErrorCode: 'indexing-failed',
    })
  })

  it('retries failed indexing without re-upload', async () => {
    const row = document({ indexStatus: 'failed', lastErrorCode: 'indexing-failed' })
    const { service } = makeHarness([row])

    await service.indexDocument(7, 1)

    expect(row.indexStatus).toBe('indexed')
    expect(row.extractedText).toContain('family history')
    expect(row.storedRelativePath).toContain('vault/users/7/documents')
  })

  it('indexes pending docs for supplied user only', async () => {
    const rows = [
      document({ id: 1, localUserId: 7, indexStatus: 'waiting_for_ai' }),
      document({ id: 2, localUserId: 7, fileName: 'Already.txt', indexStatus: 'indexed' }),
      document({ id: 3, localUserId: 8, storedRelativePath: 'vault/users/8/documents/theirs.txt', indexStatus: 'waiting_for_ai' }),
    ]
    const { service, documents, chunks } = makeHarness(rows)

    await service.indexPendingDocuments(7)

    expect(documents.listByUser).toHaveBeenCalledWith(7)
    expect(chunks.replaceDocumentIndex.mock.calls.map((call) => call[1])).toEqual([1])
    expect(chunks.replaceDocumentIndex.mock.calls.some((call) => call[0] === 8)).toBe(false)
  })

  it('queue checks AI readiness and leaves waiting_for_ai untouched when unavailable', async () => {
    const row = document({ indexStatus: 'waiting_for_ai' })
    const { service, documents, runtime } = makeHarness([row], { aiReady: false })

    service.queueDocument(7, 1)
    await Promise.resolve()
    await Promise.resolve()

    expect(documents.markIndexing).not.toHaveBeenCalled()
    expect(runtime.ensureEmbeddingRuntime).not.toHaveBeenCalled()
    expect(row.indexStatus).toBe('waiting_for_ai')
  })
})
