import { describe, expect, it, vi } from 'vitest'
import type { VaultDocumentInternal } from './vaultModels'
import { InteractiveAiGate } from '../ai/InteractiveAiGate'
import { AsyncMutationLock, type MutationLock } from '../storage/MutationLock'
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

function makeHarness(rows: VaultDocumentInternal[] = [document()], options: { aiReady?: boolean; mutationLock?: MutationLock; interactiveGate?: InteractiveAiGate } = {}) {
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
    markWaitingForAi: vi.fn(async (localUserId: number, documentId: number) => {
      const row = rows.find((candidate) => candidate.localUserId === localUserId && candidate.id === documentId)
      if (!row) throw new Error('missing')
      row.indexStatus = 'waiting_for_ai'
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
  const service = new VaultIndexService({ documents, chunks, runtime, nomic, assets, mutationLock: options.mutationLock, interactiveGate: options.interactiveGate })
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

  describe('large documents', () => {
    const longText = Array.from({ length: 30 }, (_, index) => `Paragraph ${index} `.repeat(20)).join(' ')

    function gatedEmbeddings(nomic: { embedDocument: ReturnType<typeof vi.fn> }) {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => { release = resolve })
      let calls = 0
      nomic.embedDocument.mockImplementation(async () => {
        calls += 1
        if (calls === 2) await gate
        return new Float32Array([calls, 0.5])
      })
      return () => release()
    }

    it('does not hold the Vault lock while embedding, so other Vault operations can run', async () => {
      const lock = new AsyncMutationLock()
      const { service, nomic, chunks } = makeHarness([document({ extractedText: longText })], { mutationLock: lock })
      const release = gatedEmbeddings(nomic)

      const indexing = service.indexDocument(7, 1)
      await vi.waitFor(() => expect(nomic.embedDocument).toHaveBeenCalledTimes(2))
      await expect(lock.runExclusive(async () => 'listed while indexing')).resolves.toBe('listed while indexing')
      expect(chunks.replaceDocumentIndex).not.toHaveBeenCalled()

      release()
      await indexing
      expect(chunks.replaceDocumentIndex).toHaveBeenCalledTimes(1)
    })

    it('reports how many chunks are done while indexing and clears it afterwards', async () => {
      const { service, nomic } = makeHarness([document({ extractedText: longText })])
      const release = gatedEmbeddings(nomic)

      const indexing = service.indexDocument(7, 1)
      await vi.waitFor(() => expect(nomic.embedDocument).toHaveBeenCalledTimes(2))
      const progress = service.getIndexProgress(1)
      expect(progress?.done).toBe(1)
      expect(progress?.total).toBeGreaterThan(2)

      release()
      await indexing
      expect(service.getIndexProgress(1)).toBeNull()
    })

    it('does not write chunks for a document deleted while it was being embedded', async () => {
      const rows = [document({ extractedText: longText })]
      const { service, nomic, chunks } = makeHarness(rows)
      const release = gatedEmbeddings(nomic)

      const indexing = service.indexDocument(7, 1)
      await vi.waitFor(() => expect(nomic.embedDocument).toHaveBeenCalledTimes(2))
      rows[0]!.deleteStatus = 'pending'
      release()

      await expect(indexing).resolves.toBeUndefined()
      expect(chunks.replaceDocumentIndex).not.toHaveBeenCalled()
    })

    it('returns a document to waiting_for_ai when Private AI is removed mid-indexing', async () => {
      const rows = [document({ extractedText: longText })]
      const { service, nomic, assets, documents } = makeHarness(rows)
      nomic.embedDocument.mockImplementationOnce(async () => new Float32Array([1, 0.5]))
        .mockImplementationOnce(async () => { throw new Error('embedding runtime stopped') })
      assets.getStatus.mockResolvedValue({ state: 'not_installed' })

      await expect(service.indexDocument(7, 1)).rejects.toMatchObject({ code: 'indexing-failed' })
      expect(documents.markWaitingForAi).toHaveBeenCalledWith(7, 1)
      expect(documents.markIndexFailure).not.toHaveBeenCalled()
      expect(rows[0]!.indexStatus).toBe('waiting_for_ai')
    })

    it('ignores a second request for a document that is already being indexed', async () => {
      const { service, nomic, chunks } = makeHarness([document({ extractedText: longText })])
      const release = gatedEmbeddings(nomic)

      const first = service.indexDocument(7, 1)
      await vi.waitFor(() => expect(nomic.embedDocument).toHaveBeenCalledTimes(2))
      await expect(service.indexDocument(7, 1)).resolves.toBeUndefined()

      release()
      await first
      expect(chunks.replaceDocumentIndex).toHaveBeenCalledTimes(1)
    })

    it('indexes one document at a time so smaller documents finish first', async () => {
      const rows = [
        document({ id: 1, extractedText: longText }),
        document({ id: 2, extractedText: 'A short family note that fits in one chunk.' }),
      ]
      const { service, nomic, chunks } = makeHarness(rows)
      const release = gatedEmbeddings(nomic)

      const first = service.indexDocument(7, 1)
      await vi.waitFor(() => expect(nomic.embedDocument).toHaveBeenCalledTimes(2))
      const second = service.indexDocument(7, 2)
      await Promise.resolve()
      // The second document waits (and is not marked indexing) until the first finishes.
      expect(rows[1]!.indexStatus).toBe('waiting_for_ai')

      release()
      await Promise.all([first, second])
      expect(chunks.replaceDocumentIndex.mock.calls.map((call) => call[1])).toEqual([1, 2])
    })

    it('pauses embedding while a question is being answered', async () => {
      const gate = new InteractiveAiGate()
      const { service, nomic, chunks } = makeHarness([document({ extractedText: longText })], { interactiveGate: gate })
      const endQuestion = gate.begin()

      const indexing = service.indexDocument(7, 1)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(nomic.embedDocument).not.toHaveBeenCalled()

      endQuestion()
      await indexing
      expect(chunks.replaceDocumentIndex).toHaveBeenCalledTimes(1)
    })
  })
})
