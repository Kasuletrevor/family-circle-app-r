import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../database/migrations'
import { StoryChunkRepository } from './StoryChunkRepository'

function dbWithUsers(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  runMigrations(db)
  db.prepare(`INSERT INTO users (email, password_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run('one@example.com', 'hash', 'One', 1, 1)
  db.prepare(`INSERT INTO users (email, password_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run('two@example.com', 'hash', 'Two', 1, 1)
  return db
}

function insertAnswer(db: DatabaseSync, localUserId: number, confirmed = true): number {
  const result = db.prepare(`
    INSERT INTO story_answers (
      local_user_id, field_key, schema_version, section, label, question,
      answer, language, confirmed, index_status, created_at, updated_at, confirmed_at
    ) VALUES (?, 'childhood', 1, 'Growing Up', 'Childhood', 'What was your childhood like?',
      'I grew up near the lake.', 'en', ?, 'pending', 1, 1, ?)
  `).run(localUserId, confirmed ? 1 : 0, confirmed ? 1 : null)
  return Number(result.lastInsertRowid)
}

describe('StoryChunkRepository', () => {
  it('replaces only an owned confirmed answer index and exposes safe Story provenance', async () => {
    const db = dbWithUsers()
    const answerId = insertAnswer(db, 1)
    const repo = new StoryChunkRepository(db)

    await repo.replaceAnswerIndex(1, answerId, [{
      chunkIndex: 0,
      text: 'I grew up near the lake.',
      embedding: new Float32Array([1, 0.5]),
    }], 'nomic-embed-text-v1.5.Q4_K_M', 1)

    expect(db.prepare('SELECT index_status FROM story_answers WHERE id = ?').get(answerId)).toEqual({ index_status: 'ready' })
    const chunks = await repo.listQueryChunks(1)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      answerId,
      fieldKey: 'childhood',
      chapter: 'Growing Up',
      label: 'Childhood',
      text: 'I grew up near the lake.',
      embeddingModel: 'nomic-embed-text-v1.5.Q4_K_M',
      indexVersion: 1,
    })
    expect(chunks[0]?.embedding).toBeInstanceOf(Float32Array)
    db.close()
  })

  it('rejects foreign or unconfirmed answers and deletes only owned chunks', async () => {
    const db = dbWithUsers()
    const mine = insertAnswer(db, 1)
    const theirs = insertAnswer(db, 2)
    const unconfirmed = db.prepare(`
      INSERT INTO story_answers (
        local_user_id, field_key, schema_version, section, label, question,
        answer, language, confirmed, index_status, created_at, updated_at, confirmed_at
      ) VALUES (1, 'education', 1, 'Learning', 'Education', 'Tell us about your education.',
        'Draft education', 'en', 0, 'not_indexed', 1, 1, NULL)
    `).run()
    const repo = new StoryChunkRepository(db)

    await expect(repo.replaceAnswerIndex(1, theirs, [], 'model', 1)).rejects.toThrow('Story answer not found')
    await expect(repo.replaceAnswerIndex(1, Number(unconfirmed.lastInsertRowid), [], 'model', 1)).rejects.toThrow('confirmed')

    db.prepare(`INSERT INTO story_chunks (story_answer_id, chunk_index, text, embedding_blob, embedding_model, index_version, created_at, updated_at)
      VALUES (?, 0, 'mine', X'0000803F', 'model', 1, 1, 1)`).run(mine)
    db.prepare(`INSERT INTO story_chunks (story_answer_id, chunk_index, text, embedding_blob, embedding_model, index_version, created_at, updated_at)
      VALUES (?, 0, 'theirs', X'0000803F', 'model', 1, 1, 1)`).run(theirs)

    await repo.deleteForAnswer(1, mine)
    expect(db.prepare('SELECT COUNT(*) AS n FROM story_chunks WHERE story_answer_id = ?').get(mine)).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM story_chunks WHERE story_answer_id = ?').get(theirs)).toEqual({ n: 1 })
    await expect(repo.deleteForAnswer(1, theirs)).rejects.toThrow('Story answer not found')
    db.close()
  })
})
