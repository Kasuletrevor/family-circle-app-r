import type { AuthUser } from '../../shared/desktopApi'
import {
  STORY_SCHEMA_VERSION,
  normalizeStoryLanguage,
  requireStoryField,
  type StoryFieldKey,
  type StoryLanguage,
} from '../../shared/story'
import type { StoryPublicAnswer, StoryPublicState, StoryVersionSummary } from '../../shared/storyPublic'
import { storySemanticSnapshot, type StoryAnswerInternal, type StoryDraftInput, type StorySemanticSnapshot, type StoryVersionInternal } from './storyModels'

export interface StorySessionSource {
  restore(): Promise<AuthUser | null>
}

export interface StoryLifecycleRepository {
  getStory(localUserId: number): Promise<StoryAnswerInternal[]>
  getAnswer(localUserId: number, fieldKey: StoryFieldKey): Promise<StoryAnswerInternal | null>
  saveDraft(localUserId: number, input: StoryDraftInput): Promise<StoryAnswerInternal>
  invalidateConfirmedAnswer(localUserId: number, input: StoryDraftInput): Promise<StoryAnswerInternal>
  markConfirmedPending(localUserId: number, fieldKey: StoryFieldKey): Promise<StoryAnswerInternal>
  restoreSnapshot(localUserId: number, target: StorySemanticSnapshot): Promise<StoryAnswerInternal[]>
}

export interface StoryLifecycleHistory {
  createIfChanged(localUserId: number, snapshot: StorySemanticSnapshot): Promise<number | null>
  list(localUserId: number): Promise<StoryVersionInternal[]>
  getOwned(localUserId: number, versionId: number): Promise<StoryVersionInternal | null>
}

export interface StoryLifecycleIndexer {
  indexField(localUserId: number, fieldKey: StoryFieldKey): Promise<void>
}

interface StoryServiceDependencies {
  session: StorySessionSource
  repository: StoryLifecycleRepository
  history: StoryLifecycleHistory
  index: StoryLifecycleIndexer
}

export type StoryServiceErrorCode = 'unauthenticated' | 'invalid-input' | 'not-found' | 'operation-failed'

export class StoryServiceError extends Error {
  constructor(public readonly code: StoryServiceErrorCode, message: string) {
    super(message)
    this.name = 'StoryServiceError'
  }
}

function publicAnswer(answer: StoryAnswerInternal): StoryPublicAnswer {
  return {
    fieldKey: answer.fieldKey,
    section: answer.section as StoryPublicAnswer['section'],
    label: answer.label,
    question: answer.question,
    answer: answer.answer,
    language: answer.language,
    confirmed: answer.confirmed,
    indexStatus: answer.indexStatus,
    updatedAt: answer.updatedAt,
    confirmedAt: answer.confirmedAt,
  }
}

function publicState(rows: readonly StoryAnswerInternal[]): StoryPublicState {
  const answers = rows.map(publicAnswer)
  return {
    schemaVersion: STORY_SCHEMA_VERSION,
    answers,
    confirmedCount: answers.filter((answer) => answer.confirmed).length,
  }
}

function versionSummary(item: StoryVersionInternal): StoryVersionSummary {
  return {
    versionId: item.id,
    createdAt: item.createdAt,
    confirmedCount: Object.values(item.snapshot.answers).filter((answer) => answer.confirmed).length,
  }
}

function requireVersionId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new StoryServiceError('invalid-input', 'Invalid Story version')
  }
  return Number(value)
}

function validDraftInput(input: { fieldKey: StoryFieldKey; answer: string; language: StoryLanguage }): StoryDraftInput {
  try {
    const field = requireStoryField(input?.fieldKey)
    const language = normalizeStoryLanguage(input?.language).code
    if (typeof input?.answer !== 'string') throw new Error('answer')
    return { fieldKey: field.key, answer: input.answer, language }
  } catch {
    throw new StoryServiceError('invalid-input', 'Invalid Story draft')
  }
}

export class StoryService {
  constructor(private readonly dependencies: StoryServiceDependencies) {}

  async get(): Promise<StoryPublicState> {
    const user = await this.requireSession()
    return publicState(await this.dependencies.repository.getStory(user.id))
  }

  async saveDraft(input: { fieldKey: StoryFieldKey; answer: string; language: StoryLanguage }): Promise<StoryPublicState> {
    const user = await this.requireSession()
    const draft = validDraftInput(input)
    try {
      const current = await this.dependencies.repository.getAnswer(user.id, draft.fieldKey)
      const semanticChanged = current?.answer !== draft.answer || current?.language !== draft.language
      if (current?.confirmed && semanticChanged) {
        await this.dependencies.repository.invalidateConfirmedAnswer(user.id, draft)
      } else {
        await this.dependencies.repository.saveDraft(user.id, draft)
      }
      return publicState(await this.dependencies.repository.getStory(user.id))
    } catch (error) {
      if (error instanceof StoryServiceError) throw error
      throw new StoryServiceError('operation-failed', 'Story draft could not be saved')
    }
  }

  async confirmField(input: { fieldKey: StoryFieldKey }): Promise<StoryPublicState> {
    const user = await this.requireSession()
    const fieldKey = this.requireFieldKey(input?.fieldKey)
    try {
      const current = await this.dependencies.repository.getAnswer(user.id, fieldKey)
      if (!current || !current.answer.trim()) throw new StoryServiceError('not-found', 'Story memory not found')
      await this.dependencies.repository.markConfirmedPending(user.id, fieldKey)
      try {
        await this.dependencies.index.indexField(user.id, fieldKey)
      } catch {
        // Confirmation is durable even when optional local AI is unavailable or indexing fails.
      }
      return publicState(await this.dependencies.repository.getStory(user.id))
    } catch (error) {
      if (error instanceof StoryServiceError) throw error
      throw new StoryServiceError('operation-failed', 'Story memory could not be confirmed')
    }
  }

  async retryIndexing(input: { fieldKey: StoryFieldKey }): Promise<StoryPublicState> {
    const user = await this.requireSession()
    const fieldKey = this.requireFieldKey(input?.fieldKey)
    try {
      const current = await this.dependencies.repository.getAnswer(user.id, fieldKey)
      if (!current || !current.confirmed) throw new StoryServiceError('not-found', 'Confirmed Story memory not found')
      try {
        await this.dependencies.index.indexField(user.id, fieldKey)
      } catch {
        // Retry must never make confirmed capture unavailable.
      }
      return publicState(await this.dependencies.repository.getStory(user.id))
    } catch (error) {
      if (error instanceof StoryServiceError) throw error
      throw new StoryServiceError('operation-failed', 'Story memory indexing could not be retried')
    }
  }

  async saveNow(): Promise<StoryPublicState> {
    const user = await this.requireSession()
    try {
      const rows = await this.dependencies.repository.getStory(user.id)
      await this.dependencies.history.createIfChanged(user.id, storySemanticSnapshot(rows))
      return publicState(await this.dependencies.repository.getStory(user.id))
    } catch {
      throw new StoryServiceError('operation-failed', 'Story version could not be saved')
    }
  }

  async getHistory(): Promise<StoryVersionSummary[]> {
    const user = await this.requireSession()
    try {
      return (await this.dependencies.history.list(user.id)).map(versionSummary)
    } catch {
      throw new StoryServiceError('operation-failed', 'Story history could not be loaded')
    }
  }

  async restoreVersion(input: { versionId: number }): Promise<StoryPublicState> {
    const user = await this.requireSession()
    const versionId = requireVersionId(input?.versionId)
    try {
      const version = await this.dependencies.history.getOwned(user.id, versionId)
      if (!version) throw new StoryServiceError('not-found', 'Story version not found')

      const restored = await this.dependencies.repository.restoreSnapshot(user.id, version.snapshot)
      for (const answer of restored) {
        if (!answer.confirmed || !answer.answer.trim()) continue
        try {
          await this.dependencies.index.indexField(user.id, answer.fieldKey)
        } catch {
          // Restore is durable; confirmed memories can remain pending/failed and be retried later.
        }
      }
      return publicState(await this.dependencies.repository.getStory(user.id))
    } catch (error) {
      if (error instanceof StoryServiceError) throw error
      throw new StoryServiceError('operation-failed', 'Story version could not be restored')
    }
  }

  private async requireSession(): Promise<AuthUser> {
    const user = await this.dependencies.session.restore()
    if (!user) throw new StoryServiceError('unauthenticated', 'Sign in to access My Story')
    return user
  }

  private requireFieldKey(value: unknown): StoryFieldKey {
    try {
      return requireStoryField(value).key
    } catch {
      throw new StoryServiceError('invalid-input', 'Invalid Story field')
    }
  }
}
