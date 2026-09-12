import type { DatabaseSync } from 'node:sqlite'
import {
  STORY_FIELDS,
  STORY_SCHEMA_VERSION,
  normalizeStoryLanguage,
  requireStoryField,
  type StoryFieldKey,
  type StoryIndexStatus,
} from '../../shared/story'
import { withTransaction } from '../database/database'
import { StoryHistoryRepository } from './StoryHistoryRepository'
import {
  storySemanticSignature,
  storySemanticSnapshot,
  type StoryAnswerInternal,
  type StoryDraftInput,
  type StorySemanticSnapshot,
} from './storyModels'

interface StoryAnswerRow {
  id: number
  local_user_id: number
  field_key: StoryFieldKey
  schema_version: number
  section: string
  label: string
  question: string
  answer: string
  language: StoryAnswerInternal['language']
  confirmed: number
  index_status: StoryIndexStatus
  created_at: number
  updated_at: number
  confirmed_at: number | null
}

const SELECT_COLUMNS = `
  id, local_user_id, field_key, schema_version, section, label, question,
  answer, language, confirmed, index_status, created_at, updated_at, confirmed_at
`

function shapeAnswer(row: StoryAnswerRow | undefined): StoryAnswerInternal | null {
  if (!row) return null
  return {
    id: Number(row.id),
    localUserId: Number(row.local_user_id),
    fieldKey: row.field_key,
    schemaVersion: Number(row.schema_version),
    section: String(row.section),
    label: String(row.label),
    question: String(row.question),
    answer: String(row.answer),
    language: row.language,
    confirmed: Boolean(row.confirmed),
    indexStatus: row.index_status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    confirmedAt: row.confirmed_at == null ? null : Number(row.confirmed_at),
  }
}

function requireOwnedChange(changes: number | bigint): void {
  if (Number(changes) !== 1) throw new Error('Story answer not found')
}

export class StoryRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly history: StoryHistoryRepository,
  ) {}

  async getStory(localUserId: number): Promise<StoryAnswerInternal[]> {
    return this.getStorySync(localUserId)
  }

  async getAnswer(localUserId: number, fieldKey: StoryFieldKey): Promise<StoryAnswerInternal | null> {
    requireStoryField(fieldKey)
    return this.getAnswerSync(localUserId, fieldKey)
  }

  async saveDraft(localUserId: number, input: StoryDraftInput): Promise<StoryAnswerInternal> {
    return this.saveDraftSync(localUserId, input)
  }

  async invalidateConfirmedAnswer(localUserId: number, input: StoryDraftInput): Promise<StoryAnswerInternal> {
    return withTransaction(this.db, () => {
      const current = this.getAnswerSync(localUserId, input.fieldKey)
      if (current?.confirmed) {
        this.history.createIfChangedInOpenTransaction(
          localUserId,
          storySemanticSnapshot(this.getStorySync(localUserId)),
        )
      }

      const saved = this.saveDraftSync(localUserId, input)
      const now = Date.now()
      const result = this.db.prepare(`
        UPDATE story_answers
           SET confirmed = 0,
               confirmed_at = NULL,
               index_status = 'not_indexed',
               updated_at = ?
         WHERE id = ? AND local_user_id = ?
      `).run(now, saved.id, localUserId)
      requireOwnedChange(result.changes)

      this.db.prepare('DELETE FROM story_chunks WHERE story_answer_id = ?').run(saved.id)
      const updated = this.getAnswerSync(localUserId, input.fieldKey)
      if (!updated) throw new Error('Story answer not found')
      return updated
    })
  }

  async markConfirmedPending(localUserId: number, fieldKey: StoryFieldKey): Promise<StoryAnswerInternal> {
    requireStoryField(fieldKey)
    return withTransaction(this.db, () => {
      const current = this.getAnswerSync(localUserId, fieldKey)
      if (!current || !current.answer.trim()) throw new Error('Story answer not found')

      this.db.prepare('DELETE FROM story_chunks WHERE story_answer_id = ?').run(current.id)
      const now = Date.now()
      const result = this.db.prepare(`
        UPDATE story_answers
           SET confirmed = 1,
               confirmed_at = ?,
               index_status = 'pending',
               updated_at = ?
         WHERE id = ? AND local_user_id = ?
      `).run(now, now, current.id, localUserId)
      requireOwnedChange(result.changes)

      const updated = this.getAnswerSync(localUserId, fieldKey)
      if (!updated) throw new Error('Story answer not found')
      return updated
    })
  }

  async markIndexStatus(
    localUserId: number,
    fieldKey: StoryFieldKey,
    status: StoryIndexStatus,
  ): Promise<void> {
    requireStoryField(fieldKey)
    const result = this.db.prepare(`
      UPDATE story_answers
         SET index_status = ?, updated_at = ?
       WHERE local_user_id = ? AND field_key = ?
    `).run(status, Date.now(), localUserId, fieldKey)
    requireOwnedChange(result.changes)
  }

  async restoreSnapshot(
    localUserId: number,
    target: StorySemanticSnapshot,
  ): Promise<StoryAnswerInternal[]> {
    if (target.schemaVersion !== STORY_SCHEMA_VERSION) throw new Error('Unsupported Story snapshot')

    return withTransaction(this.db, () => {
      const currentSnapshot = storySemanticSnapshot(this.getStorySync(localUserId))
      if (storySemanticSignature(currentSnapshot) !== storySemanticSignature(target)) {
        this.history.createIfChangedInOpenTransaction(localUserId, currentSnapshot)
      }

      this.db.prepare(`
        DELETE FROM story_chunks
         WHERE story_answer_id IN (
           SELECT id FROM story_answers WHERE local_user_id = ?
         )
      `).run(localUserId)
      this.db.prepare('DELETE FROM story_answers WHERE local_user_id = ?').run(localUserId)

      for (const field of STORY_FIELDS) {
        const semantic = target.answers[field.key]
        if (!semantic) continue
        const answer = String(semantic.answer ?? '')
        const language = normalizeStoryLanguage(semantic.language).code
        const confirmed = Boolean(semantic.confirmed && answer.trim())
        if (!answer && !confirmed) continue

        const now = Date.now()
        this.db.prepare(`
          INSERT INTO story_answers (
            local_user_id, field_key, schema_version, section, label, question,
            answer, language, confirmed, index_status, created_at, updated_at, confirmed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          localUserId,
          field.key,
          STORY_SCHEMA_VERSION,
          field.section,
          field.label,
          field.prompt,
          answer,
          language,
          confirmed ? 1 : 0,
          confirmed ? 'pending' : 'not_indexed',
          now,
          now,
          confirmed && semantic.confirmedAt != null ? semantic.confirmedAt : null,
        )
      }

      return this.getStorySync(localUserId)
    })
  }

  private getStorySync(localUserId: number): StoryAnswerInternal[] {
    const rows = this.db.prepare(`
      SELECT ${SELECT_COLUMNS}
        FROM story_answers
       WHERE local_user_id = ?
       ORDER BY id ASC
    `).all(localUserId) as unknown as StoryAnswerRow[]
    return rows.map((row) => shapeAnswer(row) as StoryAnswerInternal)
  }

  private getAnswerSync(localUserId: number, fieldKey: StoryFieldKey): StoryAnswerInternal | null {
    const row = this.db.prepare(`
      SELECT ${SELECT_COLUMNS}
        FROM story_answers
       WHERE local_user_id = ? AND field_key = ?
    `).get(localUserId, fieldKey) as StoryAnswerRow | undefined
    return shapeAnswer(row)
  }

  private saveDraftSync(localUserId: number, input: StoryDraftInput): StoryAnswerInternal {
    const field = requireStoryField(input.fieldKey)
    const language = normalizeStoryLanguage(input.language).code
    const now = Date.now()

    this.db.prepare(`
      INSERT INTO story_answers (
        local_user_id, field_key, schema_version, section, label, question,
        answer, language, confirmed, index_status, created_at, updated_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'not_indexed', ?, ?, NULL)
      ON CONFLICT(local_user_id, field_key) DO UPDATE SET
        schema_version = excluded.schema_version,
        section = excluded.section,
        label = excluded.label,
        question = excluded.question,
        answer = excluded.answer,
        language = excluded.language,
        updated_at = excluded.updated_at
    `).run(
      localUserId,
      field.key,
      STORY_SCHEMA_VERSION,
      field.section,
      field.label,
      field.prompt,
      input.answer,
      language,
      now,
      now,
    )

    const saved = this.getAnswerSync(localUserId, field.key)
    if (!saved) throw new Error('Failed to save Story answer')
    return saved
  }
}
