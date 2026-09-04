import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../database/migrations'
import { VaultChunkRepository } from './VaultChunkRepository'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  runMigrations(db)
  db.prepare(`
    INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(1, 'one@example.test', 'hash', 'One', 1, 1)
  db.prepare(`
    INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(2, 'two@example.test', 'hash', 'Two', 1, 1)
  return db
}

function insertDocument(db: DatabaseSync, localUserId: number, fileName: string, hash: string): number {
  const result = db.prepare(`
    INSERT INTO vault_documents (
      local_user_id, file_name, file_type, mime_type, size_bytes, sha256,
      stored_relative_path, extraction_status, index_status, word_count,
      preview, extracted_text, delete_status, uploaded_at, updated_at
    ) VALUES (?, ?, 'txt', 'text/plain', 20, ?, ?, 'ready', 'waiting_for_ai', 4,
              'preview', 'private extracted text', 'active', 1, 1)
  `).run(localUserId, fileName, hash, `vault/users/${localUserId}/documents/${hash}.txt`)
  return Number(result.lastInsertRowid)
}

function chunks(...values: Array<{ chunkIndex: number; text: string; embedding: number[] }>) {
  return values.map((value) => ({ ...value, embedding: new Float32Array(value.embedding) }))
}

describe('VaultChunkRepository persistent index', () => {
  it('atomically replaces one document index', async () => {
    const db = makeDb()
    const documentId = insertDocument(db, 1, 'History.txt', 'doc-1')
    const repository = new VaultChunkRepository(db)

    await repository.replaceDocumentIndex(1, documentId, chunks(
      { chunkIndex: 0, text: 'old one', embedding: [1, 0] },
      { chunkIndex: 1, text: 'old two', embedding: [0, 1] },
    ), 'nomic-old', 1)
    await repository.replaceDocumentIndex(1, documentId, chunks(
      { chunkIndex: 0, text: 'new only', embedding: [0.5, 0.5] },
    ), 'nomic-new', 2)

    const rows = await repository.listQueryChunks(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      documentId,
      fileName: 'History.txt',
      chunkIndex: 0,
      text: 'new only',
      embeddingModel: 'nomic-new',
      indexVersion: 2,
    })
    expect([...rows[0]!.embedding]).toEqual([0.5, 0.5])
    expect(db.prepare('SELECT index_status, last_error_code FROM vault_documents WHERE id=?').get(documentId)).toEqual({
      index_status: 'indexed',
      last_error_code: null,
    })
    db.close()
  })

  it('keeps prior index on failed replacement', async () => {
    const db = makeDb()
    const documentId = insertDocument(db, 1, 'History.txt', 'doc-1')
    const repository = new VaultChunkRepository(db)
    await repository.replaceDocumentIndex(1, documentId, chunks(
      { chunkIndex: 0, text: 'stable old index', embedding: [1, 2] },
    ), 'nomic', 1)

    await expect(repository.replaceDocumentIndex(1, documentId, chunks(
      { chunkIndex: 0, text: 'first replacement', embedding: [3, 4] },
      { chunkIndex: 0, text: 'duplicate index', embedding: [5, 6] },
    ), 'nomic', 2)).rejects.toThrow()

    const rows = await repository.listQueryChunks(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text).toBe('stable old index')
    expect(rows[0]?.indexVersion).toBe(1)
    db.close()
  })

  it('never returns another user chunks', async () => {
    const db = makeDb()
    const mine = insertDocument(db, 1, 'Mine.txt', 'mine')
    const theirs = insertDocument(db, 2, 'Theirs.txt', 'theirs')
    const repository = new VaultChunkRepository(db)
    await repository.replaceDocumentIndex(1, mine, chunks({ chunkIndex: 0, text: 'mine', embedding: [1] }), 'nomic', 1)
    await repository.replaceDocumentIndex(2, theirs, chunks({ chunkIndex: 0, text: 'theirs', embedding: [2] }), 'nomic', 1)

    const rows = await repository.listQueryChunks(1)
    expect(rows.map((row) => row.documentId)).toEqual([mine])
    expect(rows.map((row) => row.text)).toEqual(['mine'])
    db.close()
  })

  it('filters selected ids by local-user ownership', async () => {
    const db = makeDb()
    const mine = insertDocument(db, 1, 'Mine.txt', 'mine')
    const theirs = insertDocument(db, 2, 'Theirs.txt', 'theirs')
    const repository = new VaultChunkRepository(db)
    await repository.replaceDocumentIndex(1, mine, chunks({ chunkIndex: 0, text: 'mine', embedding: [1] }), 'nomic', 1)
    await repository.replaceDocumentIndex(2, theirs, chunks({ chunkIndex: 0, text: 'theirs', embedding: [2] }), 'nomic', 1)

    const rows = await repository.listQueryChunks(1, [mine, theirs])
    expect(rows.map((row) => row.documentId)).toEqual([mine])
    await expect(repository.listQueryChunks(1, [])).resolves.toEqual([])
    db.close()
  })

  it('returns documentId,fileName,chunkIndex,text,embedding for query use', async () => {
    const db = makeDb()
    const documentId = insertDocument(db, 1, 'Family Notes.txt', 'notes')
    const repository = new VaultChunkRepository(db)
    await repository.replaceDocumentIndex(1, documentId, chunks(
      { chunkIndex: 3, text: 'A family memory', embedding: [0.25, -1.5, 3.125] },
    ), 'nomic-v1', 7)

    const [row] = await repository.listQueryChunks(1, [documentId])
    expect(row).toMatchObject({ documentId, fileName: 'Family Notes.txt', chunkIndex: 3, text: 'A family memory' })
    expect([...row!.embedding]).toEqual([0.25, -1.5, 3.125])
    db.close()
  })

  it('stores model/version metadata', async () => {
    const db = makeDb()
    const documentId = insertDocument(db, 1, 'History.txt', 'history')
    const repository = new VaultChunkRepository(db)
    await repository.replaceDocumentIndex(1, documentId, chunks(
      { chunkIndex: 0, text: 'chunk', embedding: [1, 2] },
    ), 'nomic-embed-text-v1.5.Q4_K_M', 9)

    expect(db.prepare('SELECT embedding_model, index_version FROM vault_chunks WHERE document_id=?').get(documentId)).toEqual({
      embedding_model: 'nomic-embed-text-v1.5.Q4_K_M',
      index_version: 9,
    })
    db.close()
  })

  it('cascades on document delete', async () => {
    const db = makeDb()
    const documentId = insertDocument(db, 1, 'History.txt', 'history')
    const repository = new VaultChunkRepository(db)
    await repository.replaceDocumentIndex(1, documentId, chunks(
      { chunkIndex: 0, text: 'chunk', embedding: [1] },
    ), 'nomic', 1)

    db.prepare('DELETE FROM vault_documents WHERE id=? AND local_user_id=?').run(documentId, 1)

    expect(db.prepare('SELECT COUNT(*) AS count FROM vault_chunks WHERE document_id=?').get(documentId)).toEqual({ count: 0 })
    db.close()
  })
})
