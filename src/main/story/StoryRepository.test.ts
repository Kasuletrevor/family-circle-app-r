import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { STORY_FIELD_KEYS, type StoryFieldKey } from '../../shared/story'
import { runMigrations } from '../database/migrations'
import { StoryHistoryRepository } from './StoryHistoryRepository'
import { StoryRepository } from './StoryRepository'

function createDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(db)
  db.exec(`
    INSERT INTO users (id, email, password_hash) VALUES
      (1, 'one@example.com', 'hash'),
      (2, 'two@example.com', 'hash')
  `)
  return db
}

function snapshot(
  overrides: Partial<Record<StoryFieldKey, { answer: string; language?: string; confirmed?: boolean; confirmedAt?: number | null }>> = {},
) {
  return {
    schemaVersion: 1 as const,
    answers: Object.fromEntries(STORY_FIELD_KEYS.map((fieldKey) => {
      const override = overrides[fieldKey]
      return [fieldKey, {
        answer: override?.answer ?? '',
        language: override?.language ?? 'en',
        confirmed: override?.confirmed ?? false,
        confirmedAt: override?.confirmedAt ?? null,
      }]
    })),
  }
}

describe('StoryRepository', () => {
  it('upserts owned drafts with fixed schema metadata and does not create semantic history', async () => {
    const db = createDb()
    const history = new StoryHistoryRepository(db)
    const repo = new StoryRepository(db, history)

    const saved = await repo.saveDraft(1, {
      fieldKey: 'childhood',
      answer: 'The mango tree',
      language: 'en',
    })

    expect(saved).toMatchObject({
      localUserId: 1,
      fieldKey: 'childhood',
      section: 'Life Story',
      label: 'Childhood and early memories',
      question: 'What childhood memory or place still feels alive to you?',
      answer: 'The mango tree',
      language: 'en',
      confirmed: false,
      indexStatus: 'not_indexed',
    })
    expect(await repo.getStory(2)).toEqual([])
    expect(await history.list(1)).toEqual([])
    db.close()
  })

  it('snapshots confirmed wording before first edit and removes stale searchable chunks atomically', async () => {
    const db = createDb()
    const history = new StoryHistoryRepository(db)
    const repo = new StoryRepository(db, history)

    const original = await repo.saveDraft(1, {
      fieldKey: 'childhood', answer: 'Old confirmed text', language: 'en',
    })
    db.prepare(`
      UPDATE story_answers
         SET confirmed = 1, confirmed_at = 100, index_status = 'ready'
       WHERE id = ?
    `).run(original.id)
    db.prepare(`
      INSERT INTO story_chunks (
        story_answer_id, chunk_index, text, embedding_blob, embedding_model,
        index_version, created_at, updated_at
      ) VALUES (?, 0, 'stale text', ?, 'test-model', 1, 1, 1)
    `).run(original.id, Buffer.from([0, 0, 0, 0]))

    const changed = await repo.invalidateConfirmedAnswer(1, {
      fieldKey: 'childhood', answer: 'Changed draft', language: 'en',
    })

    expect(changed).toMatchObject({
      answer: 'Changed draft', confirmed: false, confirmedAt: null, indexStatus: 'not_indexed',
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM story_chunks WHERE story_answer_id = ?').get(original.id))
      .toEqual({ count: 0 })
    const versions = await history.list(1)
    expect(versions).toHaveLength(1)
    expect(versions[0]?.snapshot.answers.childhood).toMatchObject({
      answer: 'Old confirmed text', language: 'en', confirmed: true, confirmedAt: 100,
    })
    db.close()
  })

  it('restores a semantic snapshot, clears all newer chunks, and preserves the previous Story in history', async () => {
    const db = createDb()
    const history = new StoryHistoryRepository(db)
    const repo = new StoryRepository(db, history)

    const current = await repo.saveDraft(1, {
      fieldKey: 'childhood', answer: 'Current confirmed memory', language: 'en',
    })
    db.prepare("UPDATE story_answers SET confirmed=1, confirmed_at=200, index_status='ready' WHERE id=?").run(current.id)
    db.prepare(`
      INSERT INTO story_chunks (
        story_answer_id, chunk_index, text, embedding_blob, embedding_model,
        index_version, created_at, updated_at
      ) VALUES (?, 0, 'newer searchable text', ?, 'test-model', 1, 1, 1)
    `).run(current.id, Buffer.from([0, 0, 0, 0]))

    const restored = await repo.restoreSnapshot(1, snapshot({
      childhood: { answer: 'Earlier confirmed memory', language: 'en', confirmed: true, confirmedAt: 50 },
      futureMessage: { answer: 'Draft for later', language: 'fr', confirmed: false },
    }))

    expect(restored).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldKey: 'childhood', answer: 'Earlier confirmed memory', confirmed: true,
        confirmedAt: 50, indexStatus: 'pending',
      }),
      expect.objectContaining({
        fieldKey: 'futureMessage', answer: 'Draft for later', language: 'fr', confirmed: false,
        indexStatus: 'not_indexed',
      }),
    ]))
    expect(db.prepare('SELECT COUNT(*) AS count FROM story_chunks').get()).toEqual({ count: 0 })
    expect((await history.list(1))[0]?.snapshot.answers.childhood.answer).toBe('Current confirmed memory')
    db.close()
  })

  it('rolls back both the pre-restore history snapshot and canonical Story when replacement fails', async () => {
    const db = createDb()
    const history = new StoryHistoryRepository(db)
    const repo = new StoryRepository(db, history)

    await repo.saveDraft(1, { fieldKey: 'childhood', answer: 'Keep me', language: 'en' })
    db.exec(`
      CREATE TRIGGER fail_story_restore_insert
      BEFORE INSERT ON story_answers
      WHEN NEW.answer = 'RESTORE_FAIL'
      BEGIN
        SELECT RAISE(ABORT, 'restore failure');
      END;
      CREATE TRIGGER fail_story_restore_update
      BEFORE UPDATE ON story_answers
      WHEN NEW.answer = 'RESTORE_FAIL'
      BEGIN
        SELECT RAISE(ABORT, 'restore failure');
      END;
    `)

    await expect(repo.restoreSnapshot(1, snapshot({
      childhood: { answer: 'RESTORE_FAIL', confirmed: true },
    }))).rejects.toThrow()

    expect(await repo.getAnswer(1, 'childhood')).toMatchObject({ answer: 'Keep me' })
    expect(await history.list(1)).toEqual([])
    db.close()
  })
})
