import type { AuthUser } from '../../shared/desktopApi'
import type { StoryQueryChunk } from '../story/StoryChunkRepository'
import type { PrivateDirectAnswer } from '../story/StoryDirectAnswerService'
import type { VaultQueryChunk } from '../vault/VaultChunkRepository'
import { cosineSimilarity } from '../vault/cosineSimilarity'
import { EMBEDDING_INDEX_VERSION, EMBEDDING_MODEL_ID } from './embeddingContract'
import { planRetrievalQueries, selectGenerationRoute, type PrivateScopeType } from './PrivateQueryPlanner'

export const MAX_RETRIEVAL_CHUNKS = 3
const MAX_EXCERPT_CHARS = 320

export type PrivateVaultScope =
  | { type: 'all' }
  | { type: 'documents'; documentIds: number[] }

export type PrivateArchiveScope =
  | { type: 'vault'; vault: PrivateVaultScope }
  | { type: 'story' }
  | { type: 'combined'; vault: PrivateVaultScope }

export interface PrivateArchiveDocumentSource {
  sourceType: 'document'
  documentId: number
  fileName: string
  excerpt: string
}

export interface PrivateArchiveStorySource {
  sourceType: 'story'
  chapter: string
  label: string
  fileName: string
  excerpt: string
}

export type PrivateArchiveSource = PrivateArchiveDocumentSource | PrivateArchiveStorySource
export type PrivateArchiveRoute = 'direct' | 'fast' | 'complex'

export interface PrivateArchiveAnswer {
  answer: string
  sources: PrivateArchiveSource[]
  route: PrivateArchiveRoute
}

export interface PrivateArchiveQueryServiceDependencies {
  session: {
    restore(): Promise<AuthUser | null>
  }
  documents: {
    getByIdForUser(localUserId: number, documentId: number): Promise<{ id: number; deleteStatus: string } | null>
  }
  vaultChunks: {
    listQueryChunks(localUserId: number, documentIds?: number[]): Promise<VaultQueryChunk[]>
  }
  storyChunks: {
    listQueryChunks(localUserId: number): Promise<StoryQueryChunk[]>
  }
  runtime: {
    ensureEmbeddingRuntime(): Promise<boolean>
    ensureGenerationRuntime(): Promise<boolean>
  }
  nomic: {
    embedQuery(question: string): Promise<Float32Array>
  }
  qwen: {
    generateFast(question: string, context: string): Promise<string>
    generateComplex(question: string, context: string): Promise<string>
    translateForRetrieval(question: string): Promise<string>
  }
  direct: {
    answer(localUserId: number, question: string): Promise<PrivateDirectAnswer | null>
  }
}

export type PrivateArchiveQueryErrorCode =
  | 'authentication-required'
  | 'invalid-query'
  | 'invalid-scope'
  | 'private-ai-unavailable'
  | 'generation-failed'

export class PrivateArchiveQueryServiceError extends Error {
  constructor(public readonly code: PrivateArchiveQueryErrorCode, message: string) {
    super(message)
    this.name = 'PrivateArchiveQueryServiceError'
  }
}

type Candidate =
  | {
      kind: 'document'
      logicalKey: string
      documentId: number
      fileName: string
      text: string
      embedding: Float32Array
    }
  | {
      kind: 'story'
      logicalKey: string
      chapter: string
      label: string
      fileName: string
      text: string
      embedding: Float32Array
    }

function validDocumentId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function excerpt(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= MAX_EXCERPT_CHARS
    ? normalized
    : normalized.slice(0, MAX_EXCERPT_CHARS).trimEnd()
}

function compatible(model: string, version: number): boolean {
  return model === EMBEDDING_MODEL_ID && version === EMBEDDING_INDEX_VERSION
}

function noContextAnswer(scope: PrivateArchiveScope): string {
  if (scope.type === 'story') return 'I could not find it in your confirmed My Story memories.'
  if (scope.type === 'combined') return 'I could not find it in the selected My Story and Vault sources.'
  return 'I could not find it in the selected Vault documents.'
}

export class PrivateArchiveQueryService {
  constructor(private readonly dependencies: PrivateArchiveQueryServiceDependencies) {}

  async ask(input: {
    question: string
    scope: PrivateArchiveScope
    language?: string
  }): Promise<PrivateArchiveAnswer> {
    const user = await this.dependencies.session.restore()
    if (!user) throw new PrivateArchiveQueryServiceError('authentication-required', 'A protected session is required')

    const question = typeof input.question === 'string' ? input.question.trim() : ''
    if (!question) throw new PrivateArchiveQueryServiceError('invalid-query', 'A question is required')

    const documentIds = await this.validateScope(user.id, input.scope)

    if (input.scope.type !== 'vault') {
      const direct = await this.dependencies.direct.answer(user.id, question)
      if (direct) {
        return { answer: direct.answer, sources: [direct.source], route: 'direct' }
      }
    }

    const candidates = await this.loadCandidates(user.id, input.scope, documentIds)
    if (candidates.length === 0) return { answer: noContextAnswer(input.scope), sources: [], route: 'fast' }

    if (!await this.dependencies.runtime.ensureEmbeddingRuntime()) {
      throw new PrivateArchiveQueryServiceError('private-ai-unavailable', 'Private AI search is unavailable')
    }

    const queries = await planRetrievalQueries({
      question,
      language: input.language,
      translateToEnglish: async (value) => {
        if (!await this.dependencies.runtime.ensureGenerationRuntime()) {
          throw new Error('Local translation unavailable')
        }
        return this.dependencies.qwen.translateForRetrieval(value)
      },
    })

    const queryEmbeddings: Float32Array[] = []
    for (const query of queries) {
      try {
        queryEmbeddings.push(await this.dependencies.nomic.embedQuery(query))
      } catch {
        // A second multilingual query is optional; score with every successful local embedding.
      }
    }
    if (queryEmbeddings.length === 0) {
      throw new PrivateArchiveQueryServiceError('private-ai-unavailable', 'Private AI search is unavailable')
    }

    const ranked = candidates
      .flatMap((candidate) => {
        try {
          const scores = queryEmbeddings.map((queryEmbedding) => cosineSimilarity(queryEmbedding, candidate.embedding))
          const score = Math.max(...scores)
          return Number.isFinite(score) ? [{ candidate, score }] : []
        } catch {
          return []
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RETRIEVAL_CHUNKS)

    if (ranked.length === 0) return { answer: noContextAnswer(input.scope), sources: [], route: 'fast' }

    const context = ranked.map(({ candidate }, index) => (
      `[Source ${index + 1}: ${candidate.fileName}]\n${candidate.text}`
    )).join('\n\n')

    const route = selectGenerationRoute({ question, scopeType: input.scope.type as PrivateScopeType })
    const answer = await this.generateAnswer(route, question, context)

    return {
      answer,
      route,
      sources: this.deduplicateSources(ranked.map(({ candidate }) => candidate)),
    }
  }

  private async validateScope(localUserId: number, scope: PrivateArchiveScope): Promise<number[] | undefined> {
    if (!scope || !['vault', 'story', 'combined'].includes(scope.type)) {
      throw new PrivateArchiveQueryServiceError('invalid-scope', 'A valid private query scope is required')
    }
    if (scope.type === 'story') return undefined

    const vault = scope.vault
    if (vault?.type === 'all') return undefined
    if (!vault || vault.type !== 'documents' || !Array.isArray(vault.documentIds) || vault.documentIds.length === 0) {
      throw new PrivateArchiveQueryServiceError('invalid-scope', 'A valid Vault document scope is required')
    }

    const ids = [...new Set(vault.documentIds)]
    if (ids.some((id) => !validDocumentId(id))) {
      throw new PrivateArchiveQueryServiceError('invalid-scope', 'A valid Vault document scope is required')
    }
    for (const id of ids) {
      const document = await this.dependencies.documents.getByIdForUser(localUserId, id)
      if (!document || document.deleteStatus !== 'active') {
        throw new PrivateArchiveQueryServiceError('invalid-scope', 'Selected Vault document is unavailable')
      }
    }
    return ids
  }

  private async loadCandidates(
    localUserId: number,
    scope: PrivateArchiveScope,
    documentIds: number[] | undefined,
  ): Promise<Candidate[]> {
    const candidates: Candidate[] = []
    if (scope.type === 'vault' || scope.type === 'combined') {
      const rows = await this.dependencies.vaultChunks.listQueryChunks(localUserId, documentIds)
      for (const row of rows) {
        if (!compatible(row.embeddingModel, row.indexVersion)) continue
        candidates.push({
          kind: 'document',
          logicalKey: `document:${row.documentId}`,
          documentId: row.documentId,
          fileName: row.fileName,
          text: row.text,
          embedding: row.embedding,
        })
      }
    }
    if (scope.type === 'story' || scope.type === 'combined') {
      const rows = await this.dependencies.storyChunks.listQueryChunks(localUserId)
      for (const row of rows) {
        if (!compatible(row.embeddingModel, row.indexVersion)) continue
        candidates.push({
          kind: 'story',
          logicalKey: `story:${row.fieldKey}`,
          chapter: row.chapter,
          label: row.label,
          fileName: `My Story › ${row.chapter} › ${row.label}`,
          text: row.text,
          embedding: row.embedding,
        })
      }
    }
    return candidates
  }

  private async generateAnswer(route: 'fast' | 'complex', question: string, context: string): Promise<string> {
    if (!await this.dependencies.runtime.ensureGenerationRuntime()) {
      throw new PrivateArchiveQueryServiceError('private-ai-unavailable', 'Private AI generation is unavailable')
    }
    try {
      return route === 'complex'
        ? await this.dependencies.qwen.generateComplex(question, context)
        : await this.dependencies.qwen.generateFast(question, context)
    } catch {
      throw new PrivateArchiveQueryServiceError('generation-failed', 'Private AI answer generation failed')
    }
  }

  private deduplicateSources(candidates: Candidate[]): PrivateArchiveSource[] {
    const seen = new Set<string>()
    const sources: PrivateArchiveSource[] = []
    for (const candidate of candidates) {
      if (seen.has(candidate.logicalKey)) continue
      seen.add(candidate.logicalKey)
      if (candidate.kind === 'document') {
        sources.push({
          sourceType: 'document',
          documentId: candidate.documentId,
          fileName: candidate.fileName,
          excerpt: excerpt(candidate.text),
        })
      } else {
        sources.push({
          sourceType: 'story',
          chapter: candidate.chapter,
          label: candidate.label,
          fileName: candidate.fileName,
          excerpt: excerpt(candidate.text),
        })
      }
    }
    return sources
  }
}
