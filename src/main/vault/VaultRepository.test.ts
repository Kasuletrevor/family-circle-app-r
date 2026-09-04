import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../database/migrations'
import { VaultRepository } from './VaultRepository'

const databases: DatabaseSync[] = []

function freshRepository(): { db: DatabaseSync; repository: VaultRepository; userA: number; userB: number } {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(db)

  const insertUser = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
  const userA = Number(insertUser.run('a@example.com', 'hash-a').lastInsertRowid)
  const userB = Number(insertUser.run('b@example.com', 'hash-b').lastInsertRowid)

  return { db, repository: new VaultRepository(db), userA, userB }
}

function storedInput(localUserId: number, overrides: Record<string, unknown> = {}) {
  return {
    localUserId,
    fileName: 'Family History.txt',
    fileType: 'txt' as const,
    mimeType: 'text/plain',
    sizeBytes: 42,
    sha256: `hash-${localUserId}`,
    storedRelativePath: `vault/users/${localUserId}/documents/random.txt`,
    ...overrides,
  }
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

describe('VaultRepository', () => {
  it('scopes rows to the local user', async () => {
    const { repository, userA, userB } = freshRepository()
    await repository.insertStoredDocument(storedInput(userA, { fileName: 'A.txt', sha256: 'hash-a' }))
    await repository.insertStoredDocument(storedInput(userB, { fileName: 'B.txt', sha256: 'hash-b' }))

    await expect(repository.listByUser(userA)).resolves.toMatchObject([
      { localUserId: userA, fileName: 'A.txt' },
    ])
  })

  it('finds duplicate hashes only for that user', async () => {
    const { repository, userA, userB } = freshRepository()
    await repository.insertStoredDocument(storedInput(userA, { sha256: 'same-bytes' }))

    await expect(repository.findByHash(userA, 'same-bytes')).resolves.toMatchObject({ localUserId: userA })
    await expect(repository.findByHash(userB, 'same-bytes')).resolves.toBeNull()
  })

  it('allows another user to own the same hash', async () => {
    const { repository, userA, userB } = freshRepository()
    const first = await repository.insertStoredDocument(storedInput(userA, { sha256: 'shared-hash' }))
    const second = await repository.insertStoredDocument(storedInput(userB, { sha256: 'shared-hash' }))

    expect(first.localUserId).toBe(userA)
    expect(second.localUserId).toBe(userB)
    expect(second.id).not.toBe(first.id)
  })

  it('stores extraction success and failure', async () => {
    const { repository, userA } = freshRepository()
    const ready = await repository.insertStoredDocument(storedInput(userA, { sha256: 'ready-hash' }))
    const failed = await repository.insertStoredDocument(storedInput(userA, { fileName: 'Broken.txt', sha256: 'failed-hash' }))

    await repository.markExtractionSuccess(userA, ready.id, {
      extractedText: 'Grandmother kept the family letters.',
      wordCount: 5,
      preview: 'Grandmother kept the family letters.',
    })
    await repository.markExtractionFailure(userA, failed.id, 'extraction-failed')

    await expect(repository.getByIdForUser(userA, ready.id)).resolves.toMatchObject({
      extractionStatus: 'ready',
      indexStatus: 'waiting_for_ai',
      extractedText: 'Grandmother kept the family letters.',
      wordCount: 5,
      preview: 'Grandmother kept the family letters.',
      lastErrorCode: null,
    })
    await expect(repository.getByIdForUser(userA, failed.id)).resolves.toMatchObject({
      extractionStatus: 'failed',
      indexStatus: 'not_indexed',
      lastErrorCode: 'extraction-failed',
    })
  })

  it('lists pending deletions', async () => {
    const { repository, userA } = freshRepository()
    const document = await repository.insertStoredDocument(storedInput(userA))

    await repository.markDeletePending(userA, document.id)

    await expect(repository.listPendingDeletions(userA)).resolves.toMatchObject([
      { id: document.id, deleteStatus: 'pending' },
    ])
    await expect(repository.listByUser(userA)).resolves.toEqual([])
  })

  it('cannot delete by id without the matching local user', async () => {
    const { repository, userA, userB } = freshRepository()
    const document = await repository.insertStoredDocument(storedInput(userA))

    await expect(repository.deleteByIdForUser(userB, document.id)).resolves.toBe(false)
    await expect(repository.getByIdForUser(userA, document.id)).resolves.toMatchObject({ id: document.id })
  })
})
