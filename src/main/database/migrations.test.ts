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

function columns(db: DatabaseSync, tableName: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((column) => column.name)
}

function uniqueIndexColumns(db: DatabaseSync, tableName: string): string[][] {
  const uniqueIndexes = (db.prepare(`PRAGMA index_list(${tableName})`).all() as Array<{
    name: string
    unique: number
  }>).filter((index) => Number(index.unique) === 1)
  return uniqueIndexes.map((index) =>
    (db.prepare(`PRAGMA index_info(${JSON.stringify(index.name)})`).all() as Array<{ name: string }>).map((column) => column.name),
  )
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

    const currentColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
    expect(currentColumns.map((column) => column.name)).toContain('active_circle_id')
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

    expect(columns(db, 'vault_documents')).toEqual([
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

    expect(uniqueIndexColumns(db, 'vault_documents')).toContainEqual(['local_user_id', 'sha256'])

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

    expect(columns(db, 'vault_chunks')).toEqual([
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
    expect(columns(db, 'vault_chunks')).not.toContain('local_user_id')

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

  it('creates canonical private My Story tables with owned foreign keys and unique constraints', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    runMigrations(db)

    expect(columns(db, 'story_answers')).toEqual([
      'id', 'local_user_id', 'field_key', 'schema_version', 'section', 'label', 'question',
      'answer', 'language', 'confirmed', 'index_status', 'created_at', 'updated_at', 'confirmed_at',
    ])
    expect(columns(db, 'story_versions')).toEqual([
      'id', 'local_user_id', 'snapshot_json', 'semantic_signature', 'created_at',
    ])
    expect(columns(db, 'story_media_items')).toEqual([
      'id', 'local_user_id', 'field_key', 'media_type', 'file_name', 'mime_type', 'size_bytes',
      'stored_relative_path', 'storage_status', 'legacy_source_key', 'created_at',
    ])
    expect(columns(db, 'story_chunks')).toEqual([
      'id', 'story_answer_id', 'chunk_index', 'text', 'embedding_blob', 'embedding_model',
      'index_version', 'created_at', 'updated_at',
    ])
    expect(columns(db, 'story_import_state')).toEqual([
      'local_user_id', 'migration_key', 'completed_at',
    ])

    expect(uniqueIndexColumns(db, 'story_answers')).toContainEqual(['local_user_id', 'field_key'])
    expect(uniqueIndexColumns(db, 'story_media_items')).toContainEqual(['local_user_id', 'legacy_source_key'])
    expect(uniqueIndexColumns(db, 'story_chunks')).toContainEqual(['story_answer_id', 'chunk_index'])
    expect(uniqueIndexColumns(db, 'story_import_state')).toContainEqual(['local_user_id', 'migration_key'])

    const answerForeignKeys = db.prepare('PRAGMA foreign_key_list(story_answers)').all() as Array<{
      table: string
      from: string
      to: string
      on_delete: string
    }>
    expect(answerForeignKeys).toContainEqual(expect.objectContaining({
      table: 'users', from: 'local_user_id', to: 'id', on_delete: 'CASCADE',
    }))

    const versionForeignKeys = db.prepare('PRAGMA foreign_key_list(story_versions)').all() as typeof answerForeignKeys
    expect(versionForeignKeys).toContainEqual(expect.objectContaining({
      table: 'users', from: 'local_user_id', to: 'id', on_delete: 'CASCADE',
    }))

    const mediaForeignKeys = db.prepare('PRAGMA foreign_key_list(story_media_items)').all() as typeof answerForeignKeys
    expect(mediaForeignKeys).toContainEqual(expect.objectContaining({
      table: 'users', from: 'local_user_id', to: 'id', on_delete: 'CASCADE',
    }))

    const chunkForeignKeys = db.prepare('PRAGMA foreign_key_list(story_chunks)').all() as typeof answerForeignKeys
    expect(chunkForeignKeys).toContainEqual(expect.objectContaining({
      table: 'story_answers', from: 'story_answer_id', to: 'id', on_delete: 'CASCADE',
    }))

    const importForeignKeys = db.prepare('PRAGMA foreign_key_list(story_import_state)').all() as typeof answerForeignKeys
    expect(importForeignKeys).toContainEqual(expect.objectContaining({
      table: 'users', from: 'local_user_id', to: 'id', on_delete: 'CASCADE',
    }))
    db.close()
  })

  it('preserves legacy My Story source tables and rows untouched while adding canonical tables', () => {
    const db = createLegacyDatabase()
    db.exec(`
      CREATE TABLE my_stories (user_id INTEGER PRIMARY KEY, story_json TEXT NOT NULL);
      CREATE TABLE story_entries (id INTEGER PRIMARY KEY, user_id INTEGER, field_key TEXT, answer TEXT);
      CREATE TABLE story_history (id INTEGER PRIMARY KEY, user_id INTEGER, snapshot_json TEXT);
      CREATE TABLE story_media (id INTEGER PRIMARY KEY, user_id INTEGER, field_key TEXT, file_path TEXT);
      INSERT INTO my_stories VALUES (1, '{"childhood":"Old home"}');
      INSERT INTO story_entries VALUES (10, 1, 'childhood', 'Old home');
      INSERT INTO story_history VALUES (20, 1, '{"childhood":"Earlier"}');
      INSERT INTO story_media VALUES (30, 1, 'childhood', 'C:/legacy/story/photo.jpg');
    `)

    runMigrations(db)

    expect(db.prepare('SELECT * FROM my_stories').all()).toEqual([
      { user_id: 1, story_json: '{"childhood":"Old home"}' },
    ])
    expect(db.prepare('SELECT * FROM story_entries').all()).toEqual([
      { id: 10, user_id: 1, field_key: 'childhood', answer: 'Old home' },
    ])
    expect(db.prepare('SELECT * FROM story_history').all()).toEqual([
      { id: 20, user_id: 1, snapshot_json: '{"childhood":"Earlier"}' },
    ])
    expect(db.prepare('SELECT * FROM story_media').all()).toEqual([
      { id: 30, user_id: 1, field_key: 'childhood', file_path: 'C:/legacy/story/photo.jpg' },
    ])
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='story_answers'").get()).toBeTruthy()
    db.close()
  })
})
