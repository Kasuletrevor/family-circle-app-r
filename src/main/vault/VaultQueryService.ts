import type { VaultAnswer, VaultQueryScope } from '../../shared/desktopApi'
import {
  PrivateArchiveQueryServiceError,
  type PrivateArchiveAnswer,
  type PrivateArchiveQueryService,
  type PrivateArchiveScope,
} from '../ai/PrivateArchiveQueryService'

export type { VaultAnswer, VaultAnswerSource, VaultQueryScope } from '../../shared/desktopApi'

type VaultArchiveQueryPort = Pick<PrivateArchiveQueryService, 'ask'>

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

function safeVaultAnswer(result: PrivateArchiveAnswer): VaultAnswer {
  return {
    answer: result.answer,
    sources: result.sources.map((source) => source.sourceType === 'document'
      ? { sourceType: 'document', documentId: source.documentId, fileName: source.fileName, excerpt: source.excerpt }
      : { sourceType: 'story', chapter: source.chapter, label: source.label, excerpt: source.excerpt }),
  }
}

function archiveScope(scope: VaultQueryScope): PrivateArchiveScope {
  switch (scope.type) {
    case 'story': return { type: 'story' }
    case 'story-and-vault': return { type: 'combined', vault: { type: 'all' } }
    default: return { type: 'vault', vault: scope }
  }
}

export class VaultQueryService {
  constructor(private readonly archive: VaultArchiveQueryPort) {}

  async ask(input: { question: string; scope: VaultQueryScope }): Promise<VaultAnswer> {
    try {
      const result = await this.archive.ask({
        question: input.question,
        scope: archiveScope(input.scope),
      })
      return safeVaultAnswer(result)
    } catch (error) {
      if (error instanceof PrivateArchiveQueryServiceError) {
        throw new VaultQueryServiceError(error.code, error.message)
      }
      throw error
    }
  }
}
