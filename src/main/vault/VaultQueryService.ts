import {
  PrivateArchiveQueryServiceError,
  type PrivateArchiveAnswer,
  type PrivateArchiveQueryService,
} from '../ai/PrivateArchiveQueryService'

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
    sources: result.sources.flatMap((source) => source.sourceType === 'document'
      ? [{ documentId: source.documentId, fileName: source.fileName, excerpt: source.excerpt }]
      : []),
  }
}

export class VaultQueryService {
  constructor(private readonly archive: VaultArchiveQueryPort) {}

  async ask(input: { question: string; scope: VaultQueryScope }): Promise<VaultAnswer> {
    try {
      const result = await this.archive.ask({
        question: input.question,
        scope: { type: 'vault', vault: input.scope },
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
