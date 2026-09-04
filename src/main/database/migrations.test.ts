import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { runMigrations } from './migrations'

function createLegacyDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );
    INSERT INTO users (email, password) VALUES ('legacy@example.com', '$2b$12$legacyhash');
    CREATE TABLE records (id INTEGER PRIMARY KEY, extracted_text TEXT NOT NULL);
    INSERT INTO records VALUES (1, 'preserve me');
  `)
  return db
}

describe('auth database migrations', () => {
  it('creates the fresh auth schema', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db)

    const userColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string; notnull: number }>
    const names = userColumns.map((column) => column.name)

    expect(names).toEqual(expect.arrayContaining([
      'id',
      'email',
      'password_hash',
      'name',
      'server_user_id',
      'active_circle_id',
      'session_version',
      'must_change_password',
      'onboarding_completed',
      'account_origin',
      'invitation_group_id',
      'invitation_group_name',
      'invitation_role',
      'claimed_at',
      'created_at',
      'updated_at',
    ]))
    expect(names).not.toContain('password')
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='password_reset_tokens'").get()).toBeTruthy()
    db.close()
  })

  it('copies legacy password hashes into password_hash and defaults existing users safely', () => {
    const db = createLegacyDatabase()
    runMigrations(db)

    expect(db.prepare(`
      SELECT password, password_hash, account_origin, onboarding_completed,
             must_change_password, session_version
      FROM users WHERE id = 1
    `).get()).toMatchObject({
      password: '$2b$12$legacyhash',
      password_hash: '$2b$12$legacyhash',
      account_origin: 'existing',
      onboarding_completed: 1,
      must_change_password: 0,
      session_version: 0,
    })
    db.close()
  })

  it('adds active_circle_id to legacy users without losing existing data', () => {
    const db = createLegacyDatabase()
    runMigrations(db)

    const columns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toContain('active_circle_id')
    expect(db.prepare('SELECT email FROM users WHERE id = 1').get()).toEqual({ email: 'legacy@example.com' })
    db.close()
  })

  it('preserves unrelated legacy tables and rows', () => {
    const db = createLegacyDatabase()
    runMigrations(db)

    expect(db.prepare('SELECT extracted_text FROM records WHERE id = 1').get()).toEqual({ extracted_text: 'preserve me' })
    db.close()
  })

  it('creates private Vault document persistence without changing a legacy user row', () => {
    const db = createLegacyDatabase()
    runMigrations(db)

    const columns = db.prepare('PRAGMA table_info(vault_documents)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'local_user_id',
      'file_name',
      'file_type',
      'mime_type',
      'size_bytes',
      'sha256',
      'stored_relative_path',
      'extraction_status',
      'index_status',
      'word_count',
      'preview',
      'extracted_text',
      'last_error_code',
      'delete_status',
      'uploaded_at',
      'updated_at',
    ])

    const foreignKeys = db.prepare('PRAGMA foreign_key_list(vault_documents)').all() as Array<{
      table: string
      from: string
      to: string
      on_delete: string
    }>
    expect(foreignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'users',
        from: 'local_user_id',
        to: 'id',
        on_delete: 'CASCADE',
      }),
    ]))

    const uniqueIndexes = (db.prepare('PRAGMA index_list(vault_documents)').all() as Array<{
      name: string
      unique: number
    }>).filter((index) => Number(index.unique) === 1)
    const uniqueColumns = uniqueIndexes.map((index) =>
      (db.prepare(`PRAGMA index_info(${JSON.stringify(index.name)})`).all() as Array<{ name: string }>).map((column) => column.name),
    )
    expect(uniqueColumns).toContainEqual(['local_user_id', 'sha256'])

    expect(db.prepare('SELECT id, email, password FROM users WHERE id = 1').get()).toEqual({
      id: 1,
      email: 'legacy@example.com',
      password: '$2b$12$legacyhash',
    })
    db.close()
  })

  it('creates persistent Vault chunk/vector storage owned through vault_documents', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db)

    const columns = db.prepare('PRAGMA table_info(vault_chunks)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'document_id',
      'chunk_index',
      'text',
      'embedding_blob',
      'embedding_model',
      'index_version',
      'created_at',
      'updated_at',
    ])
    expect(columns.map((column) => column.name)).not.toContain('local_user_id')

    const foreignKeys = db.prepare('PRAGMA foreign_key_list(vault_chunks)').all() as Array<{
      table: string
      from: string
      to: string
      on_delete: string
    }>
    expect(foreignKeys).toContainEqual(expect.objectContaining({
      table: 'vault_documents',
      from: 'document_id',
      to: 'id',
      on_delete: 'CASCADE',
    }))

    const indexes = db.prepare('PRAGMA index_list(vault_chunks)').all() as Array<{ name: string }>
    expect(indexes.map((index) => index.name)).toContain('idx_vault_chunks_document')
    db.close()
  })
})
