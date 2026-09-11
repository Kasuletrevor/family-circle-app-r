import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { STORY_FIELD_KEYS, type StoryFieldKey } from '../../shared/story'
import { runMigrations } from '../database/migrations'
import { StoryHistoryRepository } from './StoryHistoryRepository'

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

describe('StoryHistoryRepository', () => {
  it('deduplicates semantic snapshots, ignores confirmation timestamps, and enforces ownership', async () => {
    const db = createDb()
    const history = new StoryHistoryRepository(db)

    const firstId = await history.createIfChanged(1, snapshot({
      childhood: { answer: 'The old house', confirmed: true, confirmedAt: 100 },
    }))
    expect(firstId).toEqual(expect.any(Number))

    const duplicate = await history.createIfChanged(1, snapshot({
      childhood: { answer: 'The old house', confirmed: true, confirmedAt: 999 },
    }))
    expect(duplicate).toBeNull()
    expect(await history.list(1)).toHaveLength(1)
    expect(await history.getOwned(2, firstId as number)).toBeNull()
    expect(await history.getOwned(1, firstId as number)).toMatchObject({ id: firstId, localUserId: 1 })
    db.close()
  })

  it('keeps only the newest 30 semantic versions per user', async () => {
    const db = createDb()
    const history = new StoryHistoryRepository(db)

    for (let index = 0; index < 35; index += 1) {
      await history.createIfChanged(1, snapshot({ childhood: { answer: `Memory ${index}` } }))
    }

    const versions = await history.list(1)
    expect(versions).toHaveLength(30)
    expect(versions[0]?.snapshot.answers.childhood.answer).toBe('Memory 34')
    expect(versions[29]?.snapshot.answers.childhood.answer).toBe('Memory 5')
    db.close()
  })
})
