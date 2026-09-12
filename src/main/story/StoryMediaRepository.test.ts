import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../database/migrations'
import { StoryMediaRepository } from './StoryMediaRepository'

function dbWithUsers(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  runMigrations(db)
  db.prepare(`INSERT INTO users (email, password_hash, name, created_at, updated_at) VALUES ('one@example.com','hash','One',1,1)`).run()
  db.prepare(`INSERT INTO users (email, password_hash, name, created_at, updated_at) VALUES ('two@example.com','hash','Two',1,1)`).run()
  return db
}

describe('StoryMediaRepository', () => {
  it('inserts normal active media without a legacy source key and lists it by owner', async () => {
    const db = dbWithUsers()
    const repo = new StoryMediaRepository(db)
    const row = await repo.insertActive({
      localUserId: 1,
      fieldKey: 'childhood',
      mediaType: 'photo',
      fileName: 'family.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 123,
      storedRelativePath: 'story/users/1/media/random.jpg',
    })

    expect(row).toMatchObject({ localUserId: 1, fieldKey: 'childhood', mediaType: 'photo', storageStatus: 'active', legacySourceKey: null })
    expect(await repo.listByUser(1)).toEqual([row])
    expect(await repo.listByUser(2)).toEqual([])
    db.close()
  })

  it('resolves/deletes by owner and never crosses users', async () => {
    const db = dbWithUsers()
    const repo = new StoryMediaRepository(db)
    const row = await repo.insertActive({
      localUserId: 1,
      fieldKey: 'childhood',
      mediaType: 'audio',
      fileName: 'voice.wav',
      mimeType: 'audio/wav',
      sizeBytes: 99,
      storedRelativePath: 'story/users/1/media/random.wav',
    })

    expect(await repo.getByIdForUser(2, row.id)).toBeNull()
    expect(await repo.deleteByIdForUser(2, row.id)).toBe(false)
    expect(await repo.getByIdForUser(1, row.id)).toEqual(row)
    expect(await repo.deleteByIdForUser(1, row.id)).toBe(true)
    expect(await repo.getByIdForUser(1, row.id)).toBeNull()
    db.close()
  })
})
