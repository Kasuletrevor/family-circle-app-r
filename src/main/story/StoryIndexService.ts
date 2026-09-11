import { requireStoryField, type StoryFieldKey } from '../../shared/story'
import { EMBEDDING_INDEX_VERSION, EMBEDDING_MODEL_ID } from '../ai/embeddingContract'
import { chunkDocument } from '../vault/chunkDocument'
import type { StoryAnswerInternal } from './storyModels'
import type { StoryIndexChunkInput } from './StoryChunkRepository'

export interface StoryIndexRepository {
  getAnswer(localUserId: number, fieldKey: StoryFieldKey): Promise<StoryAnswerInternal | null>
  getStory(localUserId: number): Promise<StoryAnswerInternal[]>
  markIndexStatus(localUserId: number, fieldKey: StoryFieldKey, status: StoryAnswerInternal['indexStatus']): Promise<void>
}

export interface StoryIndexChunkRepositoryPort {
  replaceAnswerIndex(
    localUserId: number,
    answerId: number,
    chunks: StoryIndexChunkInput[],
    embeddingModel: string,
    indexVersion: number,
  ): Promise<void>
  deleteForAnswer(localUserId: number, answerId: number): Promise<void>
}

export interface StoryEmbeddingRuntime {
  ensureEmbeddingRuntime(): Promise<boolean>
}

export interface StoryNomicClient {
  embedDocument(text: string): Promise<Float32Array>
}

export interface StoryAiStatusSource {
  getStatus(): Promise<{ state: string }>
}

interface StoryIndexServiceDependencies {
  repository: StoryIndexRepository
  chunks: StoryIndexChunkRepositoryPort
  runtime: StoryEmbeddingRuntime
  nomic: StoryNomicClient
  assets: StoryAiStatusSource
}

type StoryIndexErrorCode = 'not-confirmed' | 'indexing-failed'

export class StoryIndexServiceError extends Error {
  constructor(public readonly code: StoryIndexErrorCode, message: string) {
    super(message)
    this.name = 'StoryIndexServiceError'
  }
}

export class StoryIndexService {
  constructor(private readonly dependencies: StoryIndexServiceDependencies) {}

  async indexField(localUserId: number, fieldKey: StoryFieldKey): Promise<void> {
    requireStoryField(fieldKey)
    const current = await this.dependencies.repository.getAnswer(localUserId, fieldKey)
    if (!current || !current.confirmed || !current.answer.trim()) {
      throw new StoryIndexServiceError('not-confirmed', 'Story memory must be confirmed before indexing')
    }

    const status = await this.dependencies.assets.getStatus()
    if (status.state !== 'ready') return

    try {
      await this.dependencies.chunks.deleteForAnswer(localUserId, current.id)
      if (!(await this.dependencies.runtime.ensureEmbeddingRuntime())) {
        throw new Error('Embedding runtime unavailable')
      }

      const textChunks = chunkDocument(current.answer)
      if (textChunks.length === 0) throw new Error('No Story text to index')

      const indexed: StoryIndexChunkInput[] = []
      for (const chunk of textChunks) {
        indexed.push({
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          embedding: await this.dependencies.nomic.embedDocument(chunk.text),
        })
      }

      await this.dependencies.chunks.replaceAnswerIndex(
        localUserId,
        current.id,
        indexed,
        EMBEDDING_MODEL_ID,
        EMBEDDING_INDEX_VERSION,
      )
    } catch {
      try {
        await this.dependencies.repository.markIndexStatus(localUserId, fieldKey, 'failed')
      } catch {
        // Preserve the stable indexing failure even if status persistence also fails.
      }
      throw new StoryIndexServiceError('indexing-failed', 'Story memory indexing failed')
    }
  }

  async indexPendingFields(localUserId: number): Promise<void> {
    const status = await this.dependencies.assets.getStatus()
    if (status.state !== 'ready') return

    const rows = await this.dependencies.repository.getStory(localUserId)
    for (const row of rows) {
      if (!row.confirmed || row.indexStatus !== 'pending') continue
      try {
        await this.indexField(localUserId, row.fieldKey)
      } catch {
        // One failed memory must not block the rest of this user's pending Story index.
      }
    }
  }
}
