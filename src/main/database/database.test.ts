import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareDatabase, resolveDatabasePaths } from './database'

const temporaryDirectories: string[] = []

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'family-circle-db-'))
  temporaryDirectories.push(root)
  return root
}

function createLegacyDatabase(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const db = new DatabaseSync(path)
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
  db.close()
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('database preparation', () => {
  it('resolves rebuild and legacy database paths separately', () => {
    const root = createTempRoot()
    const paths = resolveDatabasePaths({
      userDataPath: join(root, 'Kin-Keepers Family Circle'),
      appDataPath: root,
    })

    expect(paths.activePath).toBe(join(root, 'Kin-Keepers Family Circle', 'family.db'))
    expect(paths.legacyPath).toBe(join(root, 'Family Circle', 'family.db'))
  })

  it('creates a new database when no legacy database exists', async () => {
    const root = createTempRoot()
    const paths = {
      userDataPath: join(root, 'new-app'),
      appDataPath: join(root, 'app-data'),
    }

    const db = await prepareDatabase(paths)
    const resolved = resolveDatabasePaths(paths)

    expect(existsSync(resolved.activePath)).toBe(true)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()).toBeTruthy()
    db.close()
  })

  it('copies the legacy database before opening the rebuild database and never modifies the source', async () => {
    const root = createTempRoot()
    const paths = {
      userDataPath: join(root, 'new-app'),
      appDataPath: join(root, 'app-data'),
    }
    const resolved = resolveDatabasePaths(paths)
    createLegacyDatabase(resolved.legacyPath)
    const sourceBefore = readFileSync(resolved.legacyPath)

    const db = await prepareDatabase(paths)
    const sourceAfter = readFileSync(resolved.legacyPath)

    expect(Buffer.compare(sourceBefore, sourceAfter)).toBe(0)
    expect(readFileSync(resolved.activePath).length).toBeGreaterThan(0)
    expect(db.prepare('SELECT email FROM users WHERE id = 1').get()).toMatchObject({ email: 'legacy@example.com' })
    db.close()
  })

  it('refuses to migrate when active and legacy paths resolve to the same file', async () => {
    const root = createTempRoot()
    await expect(prepareDatabase({
      userDataPath: join(root, 'Family Circle'),
      appDataPath: root,
    })).rejects.toThrow('Legacy database source path must not be used as the rebuild database')
  })
})
