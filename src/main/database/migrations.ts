import type { DatabaseSync } from 'node:sqlite'

type ColumnInfo = { name: string }

function tableExists(db: DatabaseSync, tableName: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName))
}

function columnNames(db: DatabaseSync, tableName: string): Set<string> {
  if (!tableExists(db, tableName)) return new Set()
  return new Set((db.prepare(`PRAGMA table_info(${tableName})`).all() as ColumnInfo[]).map((column) => column.name))
}

function addColumnIfMissing(db: DatabaseSync, tableName: string, columns: Set<string>, definition: string): void {
  const name = definition.split(/\s+/, 1)[0]
  if (columns.has(name)) return
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`)
  columns.add(name)
}

function createFreshUsersTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      name TEXT,
      server_user_id TEXT,
      active_circle_id TEXT,
      session_version INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      account_origin TEXT NOT NULL DEFAULT 'registered',
      invitation_group_id TEXT,
      invitation_group_name TEXT,
      invitation_role TEXT,
      claimed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `)
}

function migrateExistingUsersTable(db: DatabaseSync): void {
  const columns = columnNames(db, 'users')

  if (!columns.has('password_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT')
    columns.add('password_hash')
  }
  if (columns.has('password')) {
    db.exec('UPDATE users SET password_hash = password WHERE password_hash IS NULL')
  }

  addColumnIfMissing(db, 'users', columns, 'name TEXT')
  addColumnIfMissing(db, 'users', columns, 'server_user_id TEXT')
  addColumnIfMissing(db, 'users', columns, 'active_circle_id TEXT')
  addColumnIfMissing(db, 'users', columns, 'session_version INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'users', columns, 'must_change_password INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'users', columns, 'onboarding_completed INTEGER NOT NULL DEFAULT 1')
  addColumnIfMissing(db, 'users', columns, "account_origin TEXT NOT NULL DEFAULT 'existing'")
  addColumnIfMissing(db, 'users', columns, 'invitation_group_id TEXT')
  addColumnIfMissing(db, 'users', columns, 'invitation_group_name TEXT')
  addColumnIfMissing(db, 'users', columns, 'invitation_role TEXT')
  addColumnIfMissing(db, 'users', columns, 'claimed_at INTEGER')
  addColumnIfMissing(db, 'users', columns, 'created_at INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'users', columns, 'updated_at INTEGER NOT NULL DEFAULT 0')

  db.exec(`
    UPDATE users
       SET session_version = COALESCE(session_version, 0),
           must_change_password = COALESCE(must_change_password, 0),
           onboarding_completed = COALESCE(onboarding_completed, 1),
           account_origin = COALESCE(NULLIF(account_origin, ''), 'existing'),
           created_at = COALESCE(created_at, 0),
           updated_at = COALESCE(updated_at, 0)
  `)
}

function ensurePasswordResetTokens(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  const columns = columnNames(db, 'password_reset_tokens')
  addColumnIfMissing(db, 'password_reset_tokens', columns, 'attempts INTEGER NOT NULL DEFAULT 0')
  db.exec('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_created ON password_reset_tokens(user_id, created_at)')
}

function ensureVaultDocuments(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_user_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      stored_relative_path TEXT NOT NULL,
      extraction_status TEXT NOT NULL DEFAULT 'pending',
      index_status TEXT NOT NULL DEFAULT 'not_indexed',
      word_count INTEGER NOT NULL DEFAULT 0,
      preview TEXT,
      extracted_text TEXT,
      last_error_code TEXT,
      delete_status TEXT NOT NULL DEFAULT 'active',
      uploaded_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(local_user_id, sha256)
    );
    CREATE INDEX IF NOT EXISTS idx_vault_documents_user_uploaded
      ON vault_documents(local_user_id, uploaded_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_vault_documents_pending_delete
      ON vault_documents(local_user_id, delete_status);
  `)
}

function ensureVaultChunks(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding_blob BLOB NOT NULL,
      embedding_model TEXT NOT NULL,
      index_version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES vault_documents(id) ON DELETE CASCADE,
      UNIQUE(document_id, chunk_index)
    );
    CREATE INDEX IF NOT EXISTS idx_vault_chunks_document ON vault_chunks(document_id);
  `)
}

function ensureStoryAnswers(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_answers (
      id INTEGER PRIMARY KEY,
      local_user_id INTEGER NOT NULL,
      field_key TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      section TEXT NOT NULL,
      label TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'en',
      confirmed INTEGER NOT NULL DEFAULT 0,
      index_status TEXT NOT NULL DEFAULT 'not_indexed',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(local_user_id, field_key)
    );
    CREATE INDEX IF NOT EXISTS idx_story_answers_user
      ON story_answers(local_user_id, field_key);
  `)
}

function ensureStoryVersions(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_user_id INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      semantic_signature TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_story_versions_user_created
      ON story_versions(local_user_id, created_at DESC, id DESC);
  `)
}

function ensureStoryMediaItems(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_media_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_user_id INTEGER NOT NULL,
      field_key TEXT NOT NULL,
      media_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      stored_relative_path TEXT NOT NULL,
      storage_status TEXT NOT NULL DEFAULT 'active',
      legacy_source_key TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(local_user_id, legacy_source_key)
    );
    CREATE INDEX IF NOT EXISTS idx_story_media_user_field
      ON story_media_items(local_user_id, field_key, created_at DESC, id DESC);
  `)
}

function ensureStoryChunks(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_answer_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding_blob BLOB NOT NULL,
      embedding_model TEXT NOT NULL,
      index_version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (story_answer_id) REFERENCES story_answers(id) ON DELETE CASCADE,
      UNIQUE(story_answer_id, chunk_index)
    );
    CREATE INDEX IF NOT EXISTS idx_story_chunks_answer ON story_chunks(story_answer_id);
  `)
}

function ensureStoryImportState(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_import_state (
      local_user_id INTEGER NOT NULL,
      migration_key TEXT NOT NULL,
      completed_at INTEGER NOT NULL,
      PRIMARY KEY(local_user_id, migration_key),
      FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
}

export function runMigrations(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    if (!tableExists(db, 'users')) {
      createFreshUsersTable(db)
    } else {
      migrateExistingUsersTable(db)
    }
    ensurePasswordResetTokens(db)
    ensureVaultDocuments(db)
    ensureVaultChunks(db)
    ensureStoryAnswers(db)
    ensureStoryVersions(db)
    ensureStoryMediaItems(db)
    ensureStoryChunks(db)
    ensureStoryImportState(db)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
