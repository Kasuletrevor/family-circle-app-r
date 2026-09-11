import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import type { StoryAnswerInternal, StorySemanticSnapshot, StoryVersionInternal } from './storyModels'
import { StoryService } from './StoryService'

function user(id = 7): AuthUser {
  return {
    id,
    email: `user${id}@example.com`,
    name: `User ${id}`,
    accountOrigin: 'registered',
    mustChangePassword: false,
    onboardingCompleted: true,
  }
}

function answer(overrides: Partial<StoryAnswerInternal> = {}): StoryAnswerInternal {
  return {
    id: 11,
    localUserId: 7,
    fieldKey: 'childhood',
    schemaVersion: 1,
    section: 'Life Story',
    label: 'Childhood and early memories',
    question: 'What childhood memory or place still feels alive to you?',
    answer: 'Old memory',
    language: 'en',
    confirmed: false,
    indexStatus: 'not_indexed',
    createdAt: 10,
    updatedAt: 20,
    confirmedAt: null,
    ...overrides,
  }
}

function snapshot(text = 'Old memory'): StorySemanticSnapshot {
  const answers = {} as StorySemanticSnapshot['answers']
  const keys = [
    'fullName','preferredName','roots','languages','occupation','lifeStage','snapshot','childhood',
    'education','workLife','relationships','milestones','traditions','values','carePreferences','futureMessage',
  ] as const
  for (const key of keys) answers[key] = { answer: '', language: 'en', confirmed: false, confirmedAt: null }
  answers.childhood = { answer: text, language: 'en', confirmed: true, confirmedAt: 12 }
  return { schemaVersion: 1, answers }
}

function version(overrides: Partial<StoryVersionInternal> = {}): StoryVersionInternal {
  return {
    id: 3,
    localUserId: 7,
    snapshot: snapshot(),
    semanticSignature: 'signature',
    createdAt: 100,
    ...overrides,
  }
}

function harness(options: { sessionUser?: AuthUser | null; rows?: StoryAnswerInternal[] } = {}) {
  const rows = options.rows ?? [answer()]
  const session = { restore: vi.fn(async () => options.sessionUser === undefined ? user() : options.sessionUser) }
  const repository = {
    getStory: vi.fn(async (localUserId: number) => rows.filter((row) => row.localUserId === localUserId)),
    getAnswer: vi.fn(async (localUserId: number, fieldKey: string) => rows.find((row) => row.localUserId === localUserId && row.fieldKey === fieldKey) ?? null),
    saveDraft: vi.fn(async (localUserId: number, input: { fieldKey: StoryAnswerInternal['fieldKey']; answer: string; language: StoryAnswerInternal['language'] }) => {
      const existing = rows.find((row) => row.localUserId === localUserId && row.fieldKey === input.fieldKey)
      if (existing) {
        existing.answer = input.answer
        existing.language = input.language
        existing.updatedAt += 1
        return existing
      }
      const created = answer({ id: 99, localUserId, fieldKey: input.fieldKey, answer: input.answer, language: input.language })
      rows.push(created)
      return created
    }),
    invalidateConfirmedAnswer: vi.fn(async (localUserId: number, input: { fieldKey: StoryAnswerInternal['fieldKey']; answer: string; language: StoryAnswerInternal['language'] }) => {
      const existing = rows.find((row) => row.localUserId === localUserId && row.fieldKey === input.fieldKey)
      if (!existing) throw new Error('missing')
      existing.answer = input.answer
      existing.language = input.language
      existing.confirmed = false
      existing.confirmedAt = null
      existing.indexStatus = 'not_indexed'
      return existing
    }),
    markConfirmedPending: vi.fn(async (localUserId: number, fieldKey: StoryAnswerInternal['fieldKey']) => {
      const existing = rows.find((row) => row.localUserId === localUserId && row.fieldKey === fieldKey)
      if (!existing) throw new Error('missing')
      existing.confirmed = true
      existing.confirmedAt = 50
      existing.indexStatus = 'pending'
      return existing
    }),
    restoreSnapshot: vi.fn(async (localUserId: number, target: StorySemanticSnapshot) => {
      const current = rows.find((row) => row.localUserId === localUserId && row.fieldKey === 'childhood')
      if (current) {
        current.answer = target.answers.childhood.answer
        current.language = target.answers.childhood.language
        current.confirmed = target.answers.childhood.confirmed
        current.indexStatus = current.confirmed ? 'pending' : 'not_indexed'
      }
      return rows.filter((row) => row.localUserId === localUserId)
    }),
  }
  const versions = [version()]
  const history = {
    createIfChanged: vi.fn(async () => 4),
    list: vi.fn(async (localUserId: number) => versions.filter((item) => item.localUserId === localUserId)),
    getOwned: vi.fn(async (localUserId: number, id: number) => versions.find((item) => item.localUserId === localUserId && item.id === id) ?? null),
  }
  const index = {
    indexField: vi.fn(async (localUserId: number, fieldKey: StoryAnswerInternal['fieldKey']) => {
      const existing = rows.find((row) => row.localUserId === localUserId && row.fieldKey === fieldKey)
      if (existing) existing.indexStatus = 'ready'
    }),
  }
  return { service: new StoryService({ session, repository, history, index }), session, repository, history, index, rows, versions }
}

describe('StoryService', () => {
  it('requires a protected session before every lifecycle operation', async () => {
    const { service, repository, history, index } = harness({ sessionUser: null })

    await expect(service.get()).rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(service.saveDraft({ fieldKey: 'childhood', answer: 'x', language: 'en' })).rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(service.confirmField({ fieldKey: 'childhood' })).rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(service.retryIndexing({ fieldKey: 'childhood' })).rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(service.saveNow()).rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(service.getHistory()).rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(service.restoreVersion({ versionId: 3 })).rejects.toMatchObject({ code: 'unauthenticated' })

    expect(repository.getStory).not.toHaveBeenCalled()
    expect(history.list).not.toHaveBeenCalled()
    expect(index.indexField).not.toHaveBeenCalled()
  })

  it('returns safe public state for the restored local user only', async () => {
    const mine = answer({ localUserId: 7 })
    const theirs = answer({ id: 12, localUserId: 8, answer: 'Secret other-user memory' })
    const { service, repository } = harness({ rows: [mine, theirs] })

    const state = await service.get()

    expect(repository.getStory).toHaveBeenCalledWith(7)
    expect(state.answers).toHaveLength(1)
    expect(state.answers[0]).toMatchObject({ fieldKey: 'childhood', answer: 'Old memory', confirmed: false })
    expect(state).not.toHaveProperty('localUserId')
    expect(state.answers[0]).not.toHaveProperty('localUserId')
    expect(state.answers[0]).not.toHaveProperty('id')
  })

  it('validates fixed field/language inputs and atomically invalidates a changed confirmed answer', async () => {
    const row = answer({ confirmed: true, confirmedAt: 10, indexStatus: 'ready' })
    const { service, repository } = harness({ rows: [row] })

    await expect(service.saveDraft({ fieldKey: 'bogus' as never, answer: 'x', language: 'en' })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(service.saveDraft({ fieldKey: 'childhood', answer: 'x', language: 'lg' as never })).rejects.toMatchObject({ code: 'invalid-input' })

    const changed = await service.saveDraft({ fieldKey: 'childhood', answer: 'Changed memory', language: 'en' })
    expect(repository.invalidateConfirmedAnswer).toHaveBeenCalledWith(7, { fieldKey: 'childhood', answer: 'Changed memory', language: 'en' })
    expect(repository.saveDraft).not.toHaveBeenCalled()
    expect(changed.answers[0]).toMatchObject({ answer: 'Changed memory', confirmed: false, indexStatus: 'not_indexed' })
  })

  it('keeps same confirmed semantics confirmed and uses ordinary draft upsert', async () => {
    const row = answer({ confirmed: true, confirmedAt: 10, indexStatus: 'ready' })
    const { service, repository } = harness({ rows: [row] })

    await service.saveDraft({ fieldKey: 'childhood', answer: 'Old memory', language: 'en' })

    expect(repository.saveDraft).toHaveBeenCalledWith(7, { fieldKey: 'childhood', answer: 'Old memory', language: 'en' })
    expect(repository.invalidateConfirmedAnswer).not.toHaveBeenCalled()
    expect(row.confirmed).toBe(true)
  })

  it('commits confirmation before indexing and preserves pending/failed capture when local AI cannot finish', async () => {
    const { service, repository, index, rows } = harness()
    const order: string[] = []
    repository.markConfirmedPending.mockImplementationOnce(async () => {
      order.push('confirm')
      rows[0]!.confirmed = true
      rows[0]!.indexStatus = 'pending'
      return rows[0]!
    })
    index.indexField.mockImplementationOnce(async () => {
      order.push('index')
      throw new Error('C:/private/model stderr')
    })

    const state = await service.confirmField({ fieldKey: 'childhood' })

    expect(order).toEqual(['confirm', 'index'])
    expect(state.answers[0]).toMatchObject({ confirmed: true, indexStatus: 'pending' })
  })

  it('retries indexing only an owned confirmed field and returns refreshed status', async () => {
    const row = answer({ confirmed: true, indexStatus: 'failed' })
    const { service, index } = harness({ rows: [row] })

    const state = await service.retryIndexing({ fieldKey: 'childhood' })

    expect(index.indexField).toHaveBeenCalledWith(7, 'childhood')
    expect(state.answers[0]?.indexStatus).toBe('ready')
  })

  it('saveNow creates a semantic version without exposing its database identity in Story state', async () => {
    const { service, history } = harness()

    const state = await service.saveNow()

    expect(history.createIfChanged).toHaveBeenCalledTimes(1)
    expect(state).not.toHaveProperty('versionId')
  })

  it('returns safe history summaries and rejects foreign versions before restore', async () => {
    const { service, history, repository } = harness()

    const summaries = await service.getHistory()
    expect(summaries).toEqual([{ versionId: 3, createdAt: 100, confirmedCount: 1 }])
    expect(JSON.stringify(summaries)).not.toContain('signature')
    expect(JSON.stringify(summaries)).not.toContain('localUserId')

    history.getOwned.mockResolvedValueOnce(null)
    await expect(service.restoreVersion({ versionId: 99 })).rejects.toMatchObject({ code: 'not-found' })
    expect(repository.restoreSnapshot).not.toHaveBeenCalled()
  })

  it('restores atomically then reindexes confirmed fields outside restore persistence', async () => {
    const { service, repository, index, rows } = harness({ rows: [answer({ confirmed: true, indexStatus: 'ready' })] })
    const order: string[] = []
    repository.restoreSnapshot.mockImplementationOnce(async (_id, target) => {
      order.push('restore')
      rows[0]!.answer = target.answers.childhood.answer
      rows[0]!.confirmed = true
      rows[0]!.indexStatus = 'pending'
      return rows
    })
    index.indexField.mockImplementationOnce(async () => {
      order.push('index')
      throw new Error('local model unavailable')
    })

    const state = await service.restoreVersion({ versionId: 3 })

    expect(order).toEqual(['restore', 'index'])
    expect(state.answers[0]).toMatchObject({ answer: 'Old memory', confirmed: true, indexStatus: 'pending' })
  })
})
