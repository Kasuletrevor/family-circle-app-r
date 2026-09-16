import { describe, expect, it, vi } from 'vitest'
import { PrivateArchiveQueryService, PrivateArchiveQueryServiceError, type PrivateArchiveQueryServiceDependencies } from './PrivateArchiveQueryService'

function vaultChunk(documentId: number, fileName: string, chunkIndex: number, text: string, embedding: number[]) {
  return {
    documentId, fileName, chunkIndex, text,
    embedding: new Float32Array(embedding),
    embeddingModel: 'nomic-embed-text-v1.5.Q4_K_M',
    indexVersion: 1,
  }
}

function storyChunk(answerId: number, fieldKey: 'childhood' | 'values', chapter: string, label: string, text: string, embedding: number[]) {
  return {
    answerId, fieldKey, chapter, label, text,
    embedding: new Float32Array(embedding),
    embeddingModel: 'nomic-embed-text-v1.5.Q4_K_M',
    indexVersion: 1,
  }
}

function deps(overrides: Partial<PrivateArchiveQueryServiceDependencies> = {}): PrivateArchiveQueryServiceDependencies {
  return {
    session: { restore: vi.fn(async () => ({ id: 7 } as never)) },
    documents: { getByIdForUser: vi.fn(async (_userId, id) => ({ id, deleteStatus: 'active' } as never)) },
    vaultChunks: { listQueryChunks: vi.fn(async () => [vaultChunk(1, 'History.pdf', 0, 'Grandmother was born in Jinja.', [1, 0])]) },
    storyChunks: { listQueryChunks: vi.fn(async () => [storyChunk(2, 'childhood', 'Life Story', 'Childhood and early memories', 'I grew up near Jinja.', [0.9, 0.1])]) },
    runtime: {
      ensureEmbeddingRuntime: vi.fn(async () => true),
      ensureGenerationRuntime: vi.fn(async () => true),
    },
    nomic: { embedQuery: vi.fn(async () => new Float32Array([1, 0])) },
    qwen: {
      generateFast: vi.fn(async () => 'Fast grounded answer'),
      generateComplex: vi.fn(async () => 'Complex grounded answer'),
      translateForRetrieval: vi.fn(async () => 'Where was I born?'),
    },
    direct: { answer: vi.fn(async () => null) },
    ...overrides,
  }
}

describe('PrivateArchiveQueryService', () => {
  it('requires the protected session and validates every selected Vault document before any retrieval', async () => {
    const noSession = new PrivateArchiveQueryService(deps({ session: { restore: vi.fn(async () => null) } }))
    await expect(noSession.ask({ question: 'Where?', scope: { type: 'story' } })).rejects.toBeInstanceOf(PrivateArchiveQueryServiceError)
    await expect(noSession.ask({ question: 'Where?', scope: { type: 'story' } })).rejects.toMatchObject({ code: 'authentication-required' })

    const listStory = vi.fn(async () => [])
    const getByIdForUser = vi.fn(async (_userId: number, id: number) => id === 22 ? null : ({ id, deleteStatus: 'active' } as never))
    const service = new PrivateArchiveQueryService(deps({
      documents: { getByIdForUser },
      storyChunks: { listQueryChunks: listStory },
    }))

    await expect(service.ask({
      question: 'What is my name?',
      scope: { type: 'combined', vault: { type: 'documents', documentIds: [11, 22] } },
    })).rejects.toMatchObject({ code: 'invalid-scope' })
    expect(getByIdForUser).toHaveBeenCalledWith(7, 11)
    expect(getByIdForUser).toHaveBeenCalledWith(7, 22)
    expect(listStory).not.toHaveBeenCalled()
  })

  it('returns a direct confirmed Story fact without starting Nomic or Qwen', async () => {
    const direct = {
      answer: vi.fn(async () => ({
        answer: 'Amina Nansubuga',
        source: {
          sourceType: 'story' as const,
          chapter: 'Identity',
          label: 'Full name',
          fileName: 'My Story › Identity › Full name',
          excerpt: 'Amina Nansubuga',
        },
      })),
    }
    const dependencies = deps({ direct })
    const service = new PrivateArchiveQueryService(dependencies)

    const result = await service.ask({ question: 'What is my full name?', scope: { type: 'story' } })

    expect(result).toMatchObject({ answer: 'Amina Nansubuga', route: 'direct' })
    expect(dependencies.nomic.embedQuery).not.toHaveBeenCalled()
    expect(dependencies.qwen.generateFast).not.toHaveBeenCalled()
    expect(dependencies.qwen.generateComplex).not.toHaveBeenCalled()
  })

  it('ranks Story and Vault candidates together, keeps only three chunks total, and deduplicates citations by logical source', async () => {
    const generateFast = vi.fn(async () => 'Grounded')
    const service = new PrivateArchiveQueryService(deps({
      vaultChunks: {
        listQueryChunks: vi.fn(async () => [
          vaultChunk(1, 'A.pdf', 0, 'A-TOP-1', [1, 0]),
          vaultChunk(1, 'A.pdf', 1, 'A-TOP-2-SAME-DOC', [0.99, 0.01]),
          vaultChunk(3, 'C.pdf', 0, 'C-EXCLUDED-4', [0.6, 0.4]),
        ]),
      },
      storyChunks: {
        listQueryChunks: vi.fn(async () => [
          storyChunk(2, 'childhood', 'Life Story', 'Childhood and early memories', 'STORY-TOP-3', [0.95, 0.05]),
          storyChunk(4, 'values', 'Values & Wishes', 'Values and lessons', 'STORY-EXCLUDED-5', [0, 1]),
        ]),
      },
      qwen: {
        generateFast,
        generateComplex: vi.fn(async () => 'unused'),
        translateForRetrieval: vi.fn(async () => 'unused'),
      },
    }))

    const result = await service.ask({
      question: 'Tell me what is relevant.',
      scope: { type: 'combined', vault: { type: 'all' } },
    })

    expect(result.route).toBe('fast')
    expect(result.sources).toHaveLength(2)
    expect(result.sources.map((source) => source.fileName)).toEqual([
      'A.pdf',
      'My Story › Life Story › Childhood and early memories',
    ])
    const [, context] = generateFast.mock.calls[0]!
    expect(context).toContain('A-TOP-1')
    expect(context).toContain('A-TOP-2-SAME-DOC')
    expect(context).toContain('STORY-TOP-3')
    expect(context).not.toContain('C-EXCLUDED-4')
    expect(context).not.toContain('STORY-EXCLUDED-5')
  })

  it('uses Qwen translation plus original and translated embeddings for supported non-English retrieval', async () => {
    const embedQuery = vi.fn(async (query: string) => query.startsWith('Where')
      ? new Float32Array([0.8, 0.2])
      : new Float32Array([1, 0]))
    const translateForRetrieval = vi.fn(async () => 'Where was I born?')
    const service = new PrivateArchiveQueryService(deps({
      nomic: { embedQuery },
      qwen: {
        generateFast: vi.fn(async () => 'Answer'),
        generateComplex: vi.fn(async () => 'unused'),
        translateForRetrieval,
      },
    }))

    await service.ask({ question: '¿Dónde nací?', language: 'es', scope: { type: 'story' } })

    expect(translateForRetrieval).toHaveBeenCalledWith('¿Dónde nací?')
    expect(embedQuery.mock.calls.map(([query]) => query)).toEqual(['¿Dónde nací?', 'Where was I born?'])
  })

  it('reuses the English retrieval translation to select the complex Qwen budget for non-English combined synthesis', async () => {
    const generateFast = vi.fn(async () => 'fast')
    const generateComplex = vi.fn(async () => 'complex')
    const translateForRetrieval = vi.fn(async () => 'Compare my story and documents.')
    const service = new PrivateArchiveQueryService(deps({
      qwen: {
        generateFast,
        generateComplex,
        translateForRetrieval,
      },
    }))

    const result = await service.ask({
      question: 'Compara mi historia y mis documentos.',
      language: 'es',
      scope: { type: 'combined', vault: { type: 'all' } },
    })

    expect(translateForRetrieval).toHaveBeenCalledTimes(1)
    expect(result.route).toBe('complex')
    expect(result.answer).toBe('complex')
    expect(generateComplex).toHaveBeenCalledTimes(1)
    expect(generateFast).not.toHaveBeenCalled()
  })

  it('skips malformed vectors and returns a safe no-context answer without starting generation', async () => {
    const ensureGenerationRuntime = vi.fn(async () => true)
    const generateFast = vi.fn(async () => 'should not run')
    const service = new PrivateArchiveQueryService(deps({
      vaultChunks: { listQueryChunks: vi.fn(async () => [vaultChunk(1, 'Bad.pdf', 0, 'bad vector', [1, 0, 0])]) },
      storyChunks: { listQueryChunks: vi.fn(async () => []) },
      runtime: {
        ensureEmbeddingRuntime: vi.fn(async () => true),
        ensureGenerationRuntime,
      },
      qwen: {
        generateFast,
        generateComplex: vi.fn(async () => 'unused'),
        translateForRetrieval: vi.fn(async () => 'unused'),
      },
    }))

    const result = await service.ask({ question: 'Anything?', scope: { type: 'vault', vault: { type: 'all' } } })

    expect(result.answer).toBe('I could not find it in the selected Vault documents.')
    expect(result.sources).toEqual([])
    expect(ensureGenerationRuntime).not.toHaveBeenCalled()
    expect(generateFast).not.toHaveBeenCalled()
  })

  it('uses the same Qwen model with the complex token budget for explicit combined synthesis', async () => {
    const generateFast = vi.fn(async () => 'fast')
    const generateComplex = vi.fn(async () => 'complex')
    const service = new PrivateArchiveQueryService(deps({
      qwen: {
        generateFast,
        generateComplex,
        translateForRetrieval: vi.fn(async () => 'unused'),
      },
    }))

    const result = await service.ask({
      question: 'Compare my story and documents and explain the differences.',
      scope: { type: 'combined', vault: { type: 'all' } },
    })

    expect(result.route).toBe('complex')
    expect(result.answer).toBe('complex')
    expect(generateComplex).toHaveBeenCalledTimes(1)
    expect(generateFast).not.toHaveBeenCalled()
  })

  it('fails safely when the shared Qwen runtime is unavailable', async () => {
    const service = new PrivateArchiveQueryService(deps({
      runtime: {
        ensureEmbeddingRuntime: vi.fn(async () => true),
        ensureGenerationRuntime: vi.fn(async () => false),
      },
    }))

    await expect(service.ask({
      question: 'Summarize this.',
      scope: { type: 'vault', vault: { type: 'all' } },
    })).rejects.toMatchObject({ code: 'private-ai-unavailable' })
  })
})
