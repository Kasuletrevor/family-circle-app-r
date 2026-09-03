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

export function runMigrations(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    if (!tableExists(db, 'users')) {
      createFreshUsersTable(db)
    } else {
      migrateExistingUsersTable(db)
    }
    ensurePasswordResetTokens(db)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
