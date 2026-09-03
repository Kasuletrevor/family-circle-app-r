import { copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from './migrations'

export interface DatabasePathInputs {
  userDataPath: string
  appDataPath: string
  activeOverride?: string | null
}

export interface DatabasePaths {
  activePath: string
  legacyPath: string
}

function canonicalPath(filePath: string): string {
  const resolved = resolve(filePath)
  const canonical = existsSync(resolved) ? realpathSync.native(resolved) : resolved
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

export function resolveDatabasePaths(paths: DatabasePathInputs): DatabasePaths {
  return {
    activePath: paths.activeOverride || process.env.FAMILY_CIRCLE_DB_PATH || join(paths.userDataPath, 'family.db'),
    legacyPath: join(paths.appDataPath, 'Family Circle', 'family.db'),
  }
}

export function withTransaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function prepareDatabase(paths: DatabasePathInputs): Promise<DatabaseSync> {
  const { activePath, legacyPath } = resolveDatabasePaths(paths)

  if (canonicalPath(activePath) === canonicalPath(legacyPath)) {
    throw new Error('Legacy database source path must not be used as the rebuild database')
  }

  mkdirSync(dirname(activePath), { recursive: true })

  if (!existsSync(activePath) && existsSync(legacyPath)) {
    copyFileSync(legacyPath, activePath)
  }

  const db = new DatabaseSync(activePath)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = WAL')
    runMigrations(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
