import { EMBEDDING_INDEX_VERSION, EMBEDDING_MODEL_ID } from '../ai/embeddingContract'
import type { VaultDocumentInternal } from './vaultModels'
import type { VaultIndexChunkInput } from './VaultChunkRepository'
import { chunkDocument } from './chunkDocument'
import { noMutationLock, type MutationLock } from '../storage/MutationLock'

export { EMBEDDING_MODEL_ID } from '../ai/embeddingContract'
export const INDEX_VERSION = EMBEDDING_INDEX_VERSION

export interface VaultIndexDocumentRepository {
  getByIdForUser(localUserId: number, documentId: number): Promise<VaultDocumentInternal | null>
  listByUser(localUserId: number): Promise<VaultDocumentInternal[]>
  markIndexing(localUserId: number, documentId: number): Promise<void>
  markIndexFailure(localUserId: number, documentId: number, errorCode: string): Promise<void>
  markWaitingForAi(localUserId: number, documentId: number): Promise<void>
}

export interface VaultIndexProgress {
  done: number
  total: number
}

export interface VaultIndexChunkRepository {
  replaceDocumentIndex(
    localUserId: number,
    documentId: number,
    chunks: VaultIndexChunkInput[],
    embeddingModel: string,
    indexVersion: number,
  ): Promise<void>
}

export interface VaultEmbeddingRuntime {
  ensureEmbeddingRuntime(): Promise<boolean>
}

export interface VaultNomicClient {
  embedDocument(text: string): Promise<Float32Array>
}

export interface VaultAiStatusSource {
  getStatus(): Promise<{ state: string }>
}

interface VaultIndexServiceDependencies {
  documents: VaultIndexDocumentRepository
  chunks: VaultIndexChunkRepository
  runtime: VaultEmbeddingRuntime
  nomic: VaultNomicClient
  assets: VaultAiStatusSource
  mutationLock?: MutationLock
  /** Questions take priority: embedding waits between chunks while one is answered. */
  interactiveGate?: { waitUntilIdle(): Promise<void> }
}

type VaultIndexErrorCode = 'not-found' | 'not-ready' | 'indexing-failed'

export class VaultIndexServiceError extends Error {
  constructor(public readonly code: VaultIndexErrorCode, message: string) {
    super(message)
    this.name = 'VaultIndexServiceError'
  }
}

function requireDocumentId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new VaultIndexServiceError('not-found', 'Vault document not found')
  }
  return value
}

export class VaultIndexService {
  private readonly progress = new Map<number, VaultIndexProgress>()
  // One document embeds at a time: the embedding server is single-slot anyway, and
  // this way smaller documents become askable first instead of all finishing last.
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly dependencies: VaultIndexServiceDependencies) {}

  /** Chunks embedded so far for a document being indexed, or null when it is not indexing. */
  getIndexProgress(documentId: number): VaultIndexProgress | null {
    const current = this.progress.get(documentId)
    return current ? { ...current } : null
  }

  /**
   * Embedding a large document takes minutes on a laptop CPU, so the shared Vault
   * lock is held only to mark the document as indexing and to write its chunks
   * atomically. Backups therefore still see either the old or the new index, while
   * listing, uploads and deletes keep working during embedding.
   */
  async indexDocument(localUserId: number, documentId: number): Promise<void> {
    const id = requireDocumentId(documentId)
    if (this.progress.has(id)) return
    this.progress.set(id, { done: 0, total: 0 })
    const run = this.queue.then(() => this.indexNow(localUserId, id))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async indexNow(localUserId: number, id: number): Promise<void> {
    const mutationLock = this.dependencies.mutationLock ?? noMutationLock
    try {
      const text = await mutationLock.runExclusive(() => this.startIndexing(localUserId, id))

      let indexedChunks: VaultIndexChunkInput[]
      try {
        indexedChunks = await this.embed(id, text)
      } catch {
        await mutationLock.runExclusive(() => this.recordFailure(localUserId, id))
        throw new VaultIndexServiceError('indexing-failed', 'Vault document indexing failed')
      }

      await mutationLock.runExclusive(async () => {
        // The document may have been deleted or re-extracted while it was being embedded.
        const current = await this.dependencies.documents.getByIdForUser(localUserId, id)
        if (!current || current.deleteStatus !== 'active' || current.extractedText !== text) return
        try {
          await this.dependencies.chunks.replaceDocumentIndex(
            localUserId,
            id,
            indexedChunks,
            EMBEDDING_MODEL_ID,
            EMBEDDING_INDEX_VERSION,
          )
        } catch {
          await this.recordFailure(localUserId, id)
          throw new VaultIndexServiceError('indexing-failed', 'Vault document indexing failed')
        }
      })
    } finally {
      this.progress.delete(id)
    }
  }

  private async startIndexing(localUserId: number, id: number): Promise<string> {
    const document = await this.dependencies.documents.getByIdForUser(localUserId, id)
    if (!document || document.deleteStatus !== 'active') {
      throw new VaultIndexServiceError('not-found', 'Vault document not found')
    }
    const text = document.extractedText ?? ''
    if (document.extractionStatus !== 'ready' || !text.trim()) {
      throw new VaultIndexServiceError('not-ready', 'Vault document is not ready for indexing')
    }
    await this.dependencies.documents.markIndexing(localUserId, id)
    return text
  }

  private async embed(id: number, text: string): Promise<VaultIndexChunkInput[]> {
    if (!(await this.dependencies.runtime.ensureEmbeddingRuntime())) {
      throw new Error('Embedding runtime unavailable')
    }
    const textChunks = chunkDocument(text)
    if (textChunks.length === 0) throw new Error('No text to index')

    const progress = { done: 0, total: textChunks.length }
    this.progress.set(id, progress)
    const indexedChunks: VaultIndexChunkInput[] = []
    for (const chunk of textChunks) {
      await this.dependencies.interactiveGate?.waitUntilIdle()
      indexedChunks.push({
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        embedding: await this.dependencies.nomic.embedDocument(chunk.text),
      })
      progress.done += 1
    }
    return indexedChunks
  }

  private async recordFailure(localUserId: number, id: number): Promise<void> {
    try {
      // If Private AI was removed mid-indexing, wait for it to be set up again rather than fail.
      const aiReady = (await this.dependencies.assets.getStatus()).state === 'ready'
      if (aiReady) await this.dependencies.documents.markIndexFailure(localUserId, id, 'indexing-failed')
      else await this.dependencies.documents.markWaitingForAi(localUserId, id)
    } catch {
      // Preserve the stable indexing failure even if status persistence also fails.
    }
  }

  async indexPendingDocuments(localUserId: number): Promise<void> {
    const status = await this.dependencies.assets.getStatus()
    if (status.state !== 'ready') return

    const documents = await this.dependencies.documents.listByUser(localUserId)
    for (const document of documents) {
      if (document.extractionStatus !== 'ready' || document.indexStatus !== 'waiting_for_ai') continue
      try {
        await this.indexDocument(localUserId, document.id)
      } catch {
        // One document must not prevent the rest of this user's pending index from proceeding.
      }
    }
  }

  queueDocument(localUserId: number, documentId: number): void {
    void this.queueIfReady(localUserId, documentId)
  }

  private async queueIfReady(localUserId: number, documentId: number): Promise<void> {
    try {
      const status = await this.dependencies.assets.getStatus()
      if (status.state !== 'ready') return
      await this.indexDocument(localUserId, documentId)
    } catch {
      // Background indexing is best-effort; upload/extraction remains successful and retryable.
    }
  }
}
