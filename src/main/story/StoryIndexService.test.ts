import { describe, expect, it, vi } from 'vitest'
import type { StoryAnswerInternal } from './storyModels'
import { StoryIndexService } from './StoryIndexService'

function answer(overrides: Partial<StoryAnswerInternal> = {}): StoryAnswerInternal {
  return {
    id: 1,
    localUserId: 7,
    fieldKey: 'childhood',
    schemaVersion: 1,
    section: 'Growing Up',
    label: 'Childhood',
    question: 'What was your childhood like?',
    answer: 'I grew up near the lake.',
    language: 'en',
    confirmed: true,
    indexStatus: 'pending',
    createdAt: 1,
    updatedAt: 1,
    confirmedAt: 1,
    ...overrides,
  }
}

function harness(rows: StoryAnswerInternal[] = [answer()], options: { ready?: boolean } = {}) {
  const repository = {
    getAnswer: vi.fn(async (localUserId: number, fieldKey: string) => rows.find((row) => row.localUserId === localUserId && row.fieldKey === fieldKey) ?? null),
    getStory: vi.fn(async (localUserId: number) => rows.filter((row) => row.localUserId === localUserId)),
    markIndexStatus: vi.fn(async (localUserId: number, fieldKey: string, status: StoryAnswerInternal['indexStatus']) => {
      const row = rows.find((candidate) => candidate.localUserId === localUserId && candidate.fieldKey === fieldKey)
      if (!row) throw new Error('missing')
      row.indexStatus = status
    }),
  }
  const chunks = {
    replaceAnswerIndex: vi.fn(async (_localUserId: number, answerId: number) => {
      const row = rows.find((candidate) => candidate.id === answerId)
      if (row) row.indexStatus = 'ready'
    }),
    deleteForAnswer: vi.fn(async () => undefined),
  }
  const runtime = { ensureEmbeddingRuntime: vi.fn(async () => true) }
  const nomic = { embedDocument: vi.fn(async () => new Float32Array([1, 0.5])) }
  const assets = { getStatus: vi.fn(async () => ({ state: options.ready === false ? 'not_installed' : 'ready' })) }
  return { service: new StoryIndexService({ repository, chunks, runtime, nomic, assets }), repository, chunks, runtime, nomic, assets, rows }
}

describe('StoryIndexService', () => {
  it('refuses to index unconfirmed content before touching AI or chunks', async () => {
    const { service, runtime, chunks } = harness([answer({ confirmed: false, indexStatus: 'not_indexed' })])

    await expect(service.indexField(7, 'childhood')).rejects.toMatchObject({ code: 'not-confirmed' })
    expect(runtime.ensureEmbeddingRuntime).not.toHaveBeenCalled()
    expect(chunks.deleteForAnswer).not.toHaveBeenCalled()
  })

  it('leaves confirmed pending content untouched while Private AI is unavailable', async () => {
    const row = answer()
    const { service, chunks, runtime } = harness([row], { ready: false })

    await service.indexPendingFields(7)

    expect(row.indexStatus).toBe('pending')
    expect(chunks.deleteForAnswer).not.toHaveBeenCalled()
    expect(runtime.ensureEmbeddingRuntime).not.toHaveBeenCalled()
  })

  it('uses deterministic Vault chunking and persists the shared model contract after embeddings finish', async () => {
    const row = answer({ answer: 'x'.repeat(2200) })
    const { service, chunks, nomic } = harness([row])

    await service.indexField(7, 'childhood')

    expect(nomic.embedDocument).toHaveBeenCalledTimes(3)
    expect(chunks.replaceAnswerIndex).toHaveBeenCalledTimes(1)
    const [, answerId, indexed, model, version] = chunks.replaceAnswerIndex.mock.calls[0]!
    expect(answerId).toBe(row.id)
    expect(indexed).toHaveLength(3)
    expect(model).toBe('nomic-embed-text-v1.5.Q4_K_M')
    expect(version).toBe(1)
  })

  it('deletes stale chunks before inference and marks failed if embedding fails', async () => {
    const row = answer()
    const { service, chunks, repository, nomic } = harness([row])
    const order: string[] = []
    chunks.deleteForAnswer.mockImplementationOnce(async () => { order.push('delete') })
    nomic.embedDocument.mockImplementationOnce(async () => {
      order.push('embed')
      throw new Error('model stderr with private path')
    })

    await expect(service.indexField(7, 'childhood')).rejects.toMatchObject({ code: 'indexing-failed' })

    expect(order).toEqual(['delete', 'embed'])
    expect(chunks.replaceAnswerIndex).not.toHaveBeenCalled()
    expect(repository.markIndexStatus).toHaveBeenCalledWith(7, 'childhood', 'failed')
  })

  it('continues indexing other pending fields after one failure', async () => {
    const rows = [answer({ id: 1, fieldKey: 'childhood' }), answer({ id: 2, fieldKey: 'education' })]
    const { service, chunks, nomic } = harness(rows)
    nomic.embedDocument.mockRejectedValueOnce(new Error('first fails')).mockResolvedValue(new Float32Array([1, 2]))

    await service.indexPendingFields(7)

    expect(chunks.replaceAnswerIndex.mock.calls.map((call) => call[1])).toEqual([2])
    expect(rows[0]?.indexStatus).toBe('failed')
    expect(rows[1]?.indexStatus).toBe('ready')
  })
})
