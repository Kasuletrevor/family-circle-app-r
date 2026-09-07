import type { AuthUser } from '../../shared/desktopApi'
import type { VaultQueryChunk } from './VaultChunkRepository'
import { cosineSimilarity } from './cosineSimilarity'

export type VaultQueryScope =
  | { type: 'all' }
  | { type: 'documents'; documentIds: number[] }

export interface VaultAnswerSource {
  documentId: number
  fileName: string
  excerpt: string
}

export interface VaultAnswer {
  answer: string
  sources: VaultAnswerSource[]
}

export interface VaultQueryServiceDependencies {
  session: {
    restore(): Promise<AuthUser | null>
  }
  documents: {
    getByIdForUser(localUserId: number, documentId: number): Promise<{ id: number; deleteStatus: string } | null>
  }
  chunks: {
    listQueryChunks(localUserId: number, documentIds?: number[]): Promise<VaultQueryChunk[]>
  }
  runtime: {
    ensureEmbeddingRuntime(): Promise<boolean>
    ensureGenerationRuntime(): Promise<boolean>
  }
  nomic: {
    embedQuery(question: string): Promise<Float32Array>
    embedDocument?(text: string): Promise<Float32Array>
  }
  granite: {
    generate(question: string, context: string): Promise<string>
  }
}

type VaultQueryErrorCode =
  | 'authentication-required'
  | 'invalid-query'
  | 'invalid-scope'
  | 'private-ai-unavailable'
  | 'generation-failed'

export class VaultQueryServiceError extends Error {
  constructor(public readonly code: VaultQueryErrorCode, message: string) {
    super(message)
    this.name = 'VaultQueryServiceError'
  }
}

const NO_CONTEXT_ANSWER = 'I could not find it in the selected Vault documents.'
const MAX_SOURCES = 5
const MAX_EXCERPT_CHARS = 320

function validDocumentId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function excerpt(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= MAX_EXCERPT_CHARS
    ? normalized
    : normalized.slice(0, MAX_EXCERPT_CHARS).trimEnd()
}

export class VaultQueryService {
  constructor(private readonly dependencies: VaultQueryServiceDependencies) {}

  async ask(input: { question: string; scope: VaultQueryScope }): Promise<VaultAnswer> {
    const user = await this.dependencies.session.restore()
    if (!user) {
      throw new VaultQueryServiceError('authentication-required', 'A protected session is required')
    }

    const question = typeof input.question === 'string' ? input.question.trim() : ''
    if (!question) throw new VaultQueryServiceError('invalid-query', 'A question is required')

    const documentIds = await this.validateScope(user.id, input.scope)

    if (!await this.dependencies.runtime.ensureEmbeddingRuntime()) {
      throw new VaultQueryServiceError('private-ai-unavailable', 'Private AI search is unavailable')
    }

    const queryEmbedding = await this.dependencies.nomic.embedQuery(question)
    const chunks = await this.dependencies.chunks.listQueryChunks(user.id, documentIds)
    const ranked = chunks
      .flatMap((row) => {
        try {
          return [{ row, score: cosineSimilarity(queryEmbedding, row.embedding) }]
        } catch {
          return []
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SOURCES)

    if (ranked.length === 0) return { answer: NO_CONTEXT_ANSWER, sources: [] }

    if (!await this.dependencies.runtime.ensureGenerationRuntime()) {
      throw new VaultQueryServiceError('private-ai-unavailable', 'Private AI generation is unavailable')
    }

    const context = ranked.map(({ row }, index) => (
      `[Source ${index + 1}: ${row.fileName}]\n${row.text}`
    )).join('\n\n')

    let answer: string
    try {
      answer = await this.dependencies.granite.generate(question, context)
    } catch {
      throw new VaultQueryServiceError('generation-failed', 'Private AI answer generation failed')
    }

    return {
      answer,
      sources: ranked.map(({ row }) => ({
        documentId: row.documentId,
        fileName: row.fileName,
        excerpt: excerpt(row.text),
      })),
    }
  }

  private async validateScope(localUserId: number, scope: VaultQueryScope): Promise<number[] | undefined> {
    if (scope?.type === 'all') return undefined
    if (!scope || scope.type !== 'documents' || !Array.isArray(scope.documentIds) || scope.documentIds.length === 0) {
      throw new VaultQueryServiceError('invalid-scope', 'A valid Vault query scope is required')
    }

    const ids = [...new Set(scope.documentIds)]
    if (ids.some((id) => !validDocumentId(id))) {
      throw new VaultQueryServiceError('invalid-scope', 'A valid Vault query scope is required')
    }

    for (const id of ids) {
      const document = await this.dependencies.documents.getByIdForUser(localUserId, id)
      if (!document || document.deleteStatus !== 'active') {
        throw new VaultQueryServiceError('invalid-scope', 'Selected Vault document is unavailable')
      }
    }
    return ids
  }
}
