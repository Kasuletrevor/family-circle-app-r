import { describe, expect, it, vi } from 'vitest'
import { VaultQueryService, VaultQueryServiceError, type VaultQueryServiceDependencies } from './VaultQueryService'

function chunk(documentId: number, fileName: string, chunkIndex: number, text: string, embedding: number[]) {
  return {
    documentId,
    fileName,
    chunkIndex,
    text,
    embedding: new Float32Array(embedding),
    embeddingModel: 'nomic-embed-text-v1.5.Q4_K_M',
    indexVersion: 1,
  }
}

function deps(overrides: Partial<VaultQueryServiceDependencies> = {}): VaultQueryServiceDependencies {
  return {
    session: { restore: vi.fn(async () => ({ id: 7 } as never)) },
    documents: { getByIdForUser: vi.fn(async (_userId, id) => ({ id, deleteStatus: 'active' } as never)) },
    chunks: { listQueryChunks: vi.fn(async () => [chunk(1, 'History.pdf', 0, 'Grandmother was born in Jinja.', [1, 0])]) },
    runtime: {
      ensureEmbeddingRuntime: vi.fn(async () => true),
      ensureGenerationRuntime: vi.fn(async () => true),
    },
    nomic: {
      embedQuery: vi.fn(async () => new Float32Array([1, 0])),
      embedDocument: vi.fn(async () => new Float32Array([0, 1])),
    },
    granite: { generate: vi.fn(async () => 'Grandmother was born in Jinja.') },
    ...overrides,
  }
}

describe('VaultQueryService', () => {
  it('requires a protected session and a non-empty question', async () => {
    const noSession = new VaultQueryService(deps({ session: { restore: vi.fn(async () => null) } }))
    await expect(noSession.ask({ question: 'Where?', scope: { type: 'all' } })).rejects.toMatchObject({ code: 'authentication-required' })

    const service = new VaultQueryService(deps())
    await expect(service.ask({ question: '   ', scope: { type: 'all' } })).rejects.toBeInstanceOf(VaultQueryServiceError)
    await expect(service.ask({ question: '   ', scope: { type: 'all' } })).rejects.toMatchObject({ code: 'invalid-query' })
  })

  it('validates every selected id belongs to the protected local user before retrieval', async () => {
    const listQueryChunks = vi.fn(async () => [])
    const getByIdForUser = vi.fn(async (_userId: number, id: number) => id === 8 ? null : ({ id, deleteStatus: 'active' } as never))
    const service = new VaultQueryService(deps({
      documents: { getByIdForUser },
      chunks: { listQueryChunks },
    }))

    await expect(service.ask({ question: 'Question?', scope: { type: 'documents', documentIds: [3, 8] } })).rejects.toMatchObject({ code: 'invalid-scope' })
    expect(getByIdForUser).toHaveBeenCalledWith(7, 3)
    expect(getByIdForUser).toHaveBeenCalledWith(7, 8)
    expect(listQueryChunks).not.toHaveBeenCalled()
  })

  it('loads persisted chunks, embeds the query exactly once, and never document-embeds at ask time', async () => {
    const listQueryChunks = vi.fn(async () => [chunk(1, 'History.pdf', 0, 'Known fact', [1, 0])])
    const embedQuery = vi.fn(async () => new Float32Array([1, 0]))
    const embedDocument = vi.fn(async () => new Float32Array([0, 1]))
    const service = new VaultQueryService(deps({
      chunks: { listQueryChunks },
      nomic: { embedQuery, embedDocument },
    }))

    await service.ask({ question: 'Known fact?', scope: { type: 'all' } })
    expect(listQueryChunks).toHaveBeenCalledWith(7, undefined)
    expect(embedQuery).toHaveBeenCalledTimes(1)
    expect(embedQuery).toHaveBeenCalledWith('Known fact?')
    expect(embedDocument).not.toHaveBeenCalled()
  })

  it('sorts by cosine similarity, takes only the top five, and grounds Granite in those chunks', async () => {
    const chunks = [
      chunk(1, 'A.pdf', 0, 'TOP-1', [1, 0]),
      chunk(2, 'B.pdf', 0, 'TOP-2', [0.98, 0.2]),
      chunk(3, 'C.pdf', 0, 'TOP-3', [0.9, 0.3]),
      chunk(4, 'D.pdf', 0, 'TOP-4', [0.8, 0.4]),
      chunk(5, 'E.pdf', 0, 'TOP-5', [0.7, 0.5]),
      chunk(6, 'F.pdf', 0, 'EXCLUDED-6', [0, 1]),
    ]
    const generate = vi.fn(async () => 'Grounded answer')
    const service = new VaultQueryService(deps({
      chunks: { listQueryChunks: vi.fn(async () => chunks) },
      granite: { generate },
    }))

    const result = await service.ask({ question: 'Who?', scope: { type: 'all' } })
    expect(result.answer).toBe('Grounded answer')
    expect(result.sources).toHaveLength(5)
    const [, context] = generate.mock.calls[0]!
    expect(context).toContain('TOP-1')
    expect(context).toContain('TOP-5')
    expect(context).not.toContain('EXCLUDED-6')
  })

  it('does not start Granite when there is no indexed context and returns a safe no-context answer', async () => {
    const ensureGenerationRuntime = vi.fn(async () => true)
    const generate = vi.fn(async () => 'should not run')
    const service = new VaultQueryService(deps({
      chunks: { listQueryChunks: vi.fn(async () => []) },
      runtime: { ensureEmbeddingRuntime: vi.fn(async () => true), ensureGenerationRuntime },
      granite: { generate },
    }))

    const result = await service.ask({ question: 'Anything?', scope: { type: 'all' } })
    expect(result.answer).toBe('I could not find it in the selected Vault documents.')
    expect(result.sources).toEqual([])
    expect(ensureGenerationRuntime).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  })

  it('returns only safe documentId, fileName and <=320-char excerpts as sources', async () => {
    const longText = `private ${'x'.repeat(500)}`
    const service = new VaultQueryService(deps({
      chunks: { listQueryChunks: vi.fn(async () => [chunk(9, 'Letters.txt', 0, longText, [1, 0])]) },
    }))

    const result = await service.ask({ question: 'What?', scope: { type: 'all' } })
    expect(Object.keys(result).sort()).toEqual(['answer', 'sources'])
    expect(Object.keys(result.sources[0]!).sort()).toEqual(['documentId', 'excerpt', 'fileName'])
    expect(result.sources[0]!.excerpt.length).toBeLessThanOrEqual(320)
    const serialized = JSON.stringify(result)
    for (const forbidden of ['embedding', 'storedRelativePath', 'extractedText', '127.0.0.1', 'modelPath']) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})
