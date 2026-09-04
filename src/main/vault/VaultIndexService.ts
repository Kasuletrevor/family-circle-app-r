import type { VaultDocumentInternal } from './vaultModels'
import type { VaultIndexChunkInput } from './VaultChunkRepository'
import { chunkDocument } from './chunkDocument'

export const INDEX_VERSION = 1
export const EMBEDDING_MODEL_ID = 'nomic-embed-text-v1.5.Q4_K_M'

export interface VaultIndexDocumentRepository {
  getByIdForUser(localUserId: number, documentId: number): Promise<VaultDocumentInternal | null>
  listByUser(localUserId: number): Promise<VaultDocumentInternal[]>
  markIndexing(localUserId: number, documentId: number): Promise<void>
  markIndexFailure(localUserId: number, documentId: number, errorCode: string): Promise<void>
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
  constructor(private readonly dependencies: VaultIndexServiceDependencies) {}

  async indexDocument(localUserId: number, documentId: number): Promise<void> {
    const id = requireDocumentId(documentId)
    const document = await this.dependencies.documents.getByIdForUser(localUserId, id)
    if (!document || document.deleteStatus !== 'active') {
      throw new VaultIndexServiceError('not-found', 'Vault document not found')
    }
    if (document.extractionStatus !== 'ready' || !document.extractedText?.trim()) {
      throw new VaultIndexServiceError('not-ready', 'Vault document is not ready for indexing')
    }

    await this.dependencies.documents.markIndexing(localUserId, id)

    try {
      if (!(await this.dependencies.runtime.ensureEmbeddingRuntime())) {
        throw new Error('Embedding runtime unavailable')
      }

      const textChunks = chunkDocument(document.extractedText)
      if (textChunks.length === 0) throw new Error('No text to index')

      const indexedChunks: VaultIndexChunkInput[] = []
      for (const chunk of textChunks) {
        indexedChunks.push({
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          embedding: await this.dependencies.nomic.embedDocument(chunk.text),
        })
      }

      await this.dependencies.chunks.replaceDocumentIndex(
        localUserId,
        id,
        indexedChunks,
        EMBEDDING_MODEL_ID,
        INDEX_VERSION,
      )
    } catch {
      try {
        await this.dependencies.documents.markIndexFailure(localUserId, id, 'indexing-failed')
      } catch {
        // Preserve the stable indexing failure even if status persistence also fails.
      }
      throw new VaultIndexServiceError('indexing-failed', 'Vault document indexing failed')
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
