import type { AuthUser } from '../../shared/desktopApi'
import type { StoryQueryChunk } from '../story/StoryChunkRepository'
import type { PrivateDirectAnswer } from '../story/StoryDirectAnswerService'
import type { VaultQueryChunk } from '../vault/VaultChunkRepository'
import { cosineSimilarity } from '../vault/cosineSimilarity'
import { STORY_LANGUAGES } from '../../shared/story'
import { EMBEDDING_INDEX_VERSION, EMBEDDING_MODEL_ID } from './embeddingContract'
import { fuseRankings, KeywordIndex } from './keywordSearch'
import { planRetrievalQueries, selectGenerationRoute, type PrivateScopeType } from './PrivateQueryPlanner'

export const MAX_RETRIEVAL_CHUNKS = 3
const MAX_EXCERPT_CHARS = 320
/** Keyword indexes kept in memory, one per recently asked scope. */
const MAX_CACHED_KEYWORD_INDEXES = 3

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
    generateFast(question: string, context: string, languageLabel?: string): Promise<string>
    generateComplex(question: string, context: string, languageLabel?: string): Promise<string>
    translateForRetrieval(question: string): Promise<string>
  }
  direct: {
    answer(localUserId: number, question: string): Promise<PrivateDirectAnswer | null>
  }
  /** Marks a question in progress so background indexing yields the CPU to it. */
  interactiveGate?: { begin(): () => void }
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

/** Identifies the exact sections in scope, so a cached keyword index is reused only for them. */
function fingerprint(candidates: Candidate[]): string {
  let hash = 0x811c9dc5
  const mix = (text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  for (const candidate of candidates) {
    mix(candidate.logicalKey)
    mix('\u0000')
    mix(candidate.text)
    mix('\u0001')
  }
  return `${candidates.length}:${(hash >>> 0).toString(16)}`
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

const NOT_FOUND_BY_LANGUAGE: Record<string, string> = {
  fr: "Je ne l'ai pas trouvé dans vos sources privées.",
  es: 'No lo encontré en tus fuentes privadas.',
  pt: 'Não encontrei isso nas suas fontes privadas.',
  zh: '我在您的私人资料中没有找到相关内容。',
  ja: 'あなたのプライベートな資料には見つかりませんでした。',
  fil: 'Hindi ko ito nakita sa iyong mga pribadong sanggunian.',
}

function languageLabel(language: string | undefined): string | undefined {
  const code = String(language ?? '').trim().toLowerCase().split(/[-_]/)[0]
  return STORY_LANGUAGES.find((item) => item.code === code)?.label
}

function noContextAnswer(scope: PrivateArchiveScope, language?: string): string {
  const code = String(language ?? '').trim().toLowerCase().split(/[-_]/)[0]
  const localised = NOT_FOUND_BY_LANGUAGE[code]
  if (localised) return localised
  if (scope.type === 'story') return 'I could not find it in your confirmed My Story memories.'
  if (scope.type === 'combined') return 'I could not find it in the selected My Story and Vault sources.'
  return 'I could not find it in the selected Vault documents.'
}

// The model is asked to reply exactly NOT_FOUND when its sources do not answer the
// question. A 0.8B model does not always comply, so common "not found" wording in the
// first sentence also counts; later sentences may legitimately note a gap.
const NOT_FOUND_SENTINEL = /^\s*not_found\b/i
const NOT_FOUND_WORDING = [
  /\b(?:could not|couldn't|cannot|can't|unable to) find\b/i,
  /\bno (?:information|mention|details?|record)\b/i,
  /\b(?:does not|doesn't|do not|don't) (?:mention|contain|say|include|specify|provide)\b/i,
  /\bis not (?:mentioned|provided|included|specified|stated)\b/i,
]

export function isNotFoundAnswer(answer: string): boolean {
  if (NOT_FOUND_SENTINEL.test(answer)) return true
  const firstSentence = answer.trim().split(/(?<=[.!?])\s+/)[0] ?? ''
  return NOT_FOUND_WORDING.some((pattern) => pattern.test(firstSentence))
}

export class PrivateArchiveQueryService {
  private readonly keywordIndexes = new Map<string, KeywordIndex>()

  constructor(private readonly dependencies: PrivateArchiveQueryServiceDependencies) {}

  async ask(input: {
    question: string
    scope: PrivateArchiveScope
    language?: string
  }): Promise<PrivateArchiveAnswer> {
    const end = this.dependencies.interactiveGate?.begin()
    try {
      return await this.answer(input)
    } finally {
      end?.()
    }
  }

  private async answer(input: {
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
    if (candidates.length === 0) return { answer: noContextAnswer(input.scope, input.language), sources: [], route: 'fast' }

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

    // Meaning-based ranking finds rewordings; keyword ranking finds exact names, numbers
    // and rare words that a large document can otherwise bury. Both are fused.
    const vectorRanking = candidates
      .flatMap((candidate, index) => {
        try {
          const scores = queryEmbeddings.map((queryEmbedding) => cosineSimilarity(queryEmbedding, candidate.embedding))
          const score = Math.max(...scores)
          return Number.isFinite(score) ? [{ index, score }] : []
        } catch {
          return []
        }
      })
      .sort((a, b) => b.score - a.score)
      .map(({ index }) => index)
    const keywordRanking = this.keywordIndexFor(candidates).rank(queries)
    const ranked = fuseRankings([vectorRanking, keywordRanking], candidates.length)
      .slice(0, MAX_RETRIEVAL_CHUNKS)
      .map((index) => ({ candidate: candidates[index]! }))

    if (ranked.length === 0) return { answer: noContextAnswer(input.scope, input.language), sources: [], route: 'fast' }

    const context = ranked.map(({ candidate }, index) => (
      `[Source ${index + 1}: ${candidate.fileName}]\n${candidate.text}`
    )).join('\n\n')

    const route = selectGenerationRoute({
      question,
      translatedQuestion: queries[1],
      scopeType: input.scope.type as PrivateScopeType,
    })
    const answer = await this.generateAnswer(route, question, context, languageLabel(input.language))

    // Retrieved chunks that did not answer the question are not sources of the reply.
    if (NOT_FOUND_SENTINEL.test(answer)) return { answer: noContextAnswer(input.scope, input.language), sources: [], route }
    if (isNotFoundAnswer(answer)) return { answer, sources: [], route }

    return {
      answer,
      route,
      sources: this.deduplicateSources(ranked.map(({ candidate }) => candidate)),
    }
  }

  private keywordIndexFor(candidates: Candidate[]): KeywordIndex {
    const key = fingerprint(candidates)
    let index = this.keywordIndexes.get(key)
    if (index) {
      this.keywordIndexes.delete(key)
    } else {
      index = new KeywordIndex(candidates.map((candidate) => candidate.text))
    }
    this.keywordIndexes.set(key, index)
    while (this.keywordIndexes.size > MAX_CACHED_KEYWORD_INDEXES) {
      this.keywordIndexes.delete(this.keywordIndexes.keys().next().value!)
    }
    return index
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

  private async generateAnswer(route: 'fast' | 'complex', question: string, context: string, label?: string): Promise<string> {
    if (!await this.dependencies.runtime.ensureGenerationRuntime()) {
      throw new PrivateArchiveQueryServiceError('private-ai-unavailable', 'Private AI generation is unavailable')
    }
    try {
      return route === 'complex'
        ? await this.dependencies.qwen.generateComplex(question, context, label)
        : await this.dependencies.qwen.generateFast(question, context, label)
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
