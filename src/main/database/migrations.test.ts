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
})
