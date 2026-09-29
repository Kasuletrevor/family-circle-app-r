import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// A restore is applied in two phases because the live SQLite database is held
// open (and locked on Windows) while the app runs:
//   1. stageRestore copies a validated backup into <userData>/pending-restore
//      and the app relaunches.
//   2. applyPendingRestore runs at startup, before the database is opened. It
//      moves the current data into <userData>/pre-restore (a safety copy that
//      is replaced by the next restore) and moves the staged data into place,
//      rolling back if any step fails.

const PENDING_DIR = 'pending-restore'
const STAGING_DIR = 'pending-restore.tmp'
const SAFETY_DIR = 'pre-restore'
const MARKER_FILE = 'restore.json'
const DATA_DIRECTORIES = ['vault', 'story'] as const
const SQLITE_SIDE_FILES = ['-wal', '-shm'] as const

export interface BackupManifest {
  formatVersion: number
  createdAt: number
  appVersion: string
  includes: string[]
}

export interface ValidatedBackup {
  folderPath: string
  manifest: BackupManifest
}

function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? '').trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }
  return false
}

export async function validateBackupFolder(input: {
  folderPath: string
  appVersion: string
  expectedEmail: string
}): Promise<ValidatedBackup> {
  const invalid = 'That folder is not a Family Circle backup.'
  let manifest: BackupManifest
  try {
    manifest = JSON.parse(await readFile(join(input.folderPath, 'backup.json'), 'utf8')) as BackupManifest
  } catch {
    throw new Error(invalid)
  }

  if (manifest?.formatVersion !== 1 || !Array.isArray(manifest.includes) || !manifest.includes.includes('database')) {
    throw new Error(invalid)
  }
  if (isNewerVersion(manifest.appVersion, input.appVersion)) {
    throw new Error('This backup was made by a newer version of Family Circle. Update the app before restoring it.')
  }

  const databasePath = join(input.folderPath, 'family.db')
  if (!existsSync(databasePath)) throw new Error(invalid)

  let backupDb: DatabaseSync | null = null
  try {
    backupDb = new DatabaseSync(databasePath, { readOnly: true })
    const row = backupDb.prepare('SELECT COUNT(*) AS count, MIN(email) AS email FROM users').get() as {
      count: number
      email: string | null
    } | undefined
    if (!row || Number(row.count) !== 1) {
      throw new Error('This backup does not contain exactly one Family Circle account.')
    }
    if (String(row.email ?? '').trim().toLowerCase() !== input.expectedEmail.trim().toLowerCase()) {
      throw new Error('This backup belongs to a different Family Circle account.')
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('This backup')) throw error
    throw new Error(invalid)
  } finally {
    backupDb?.close()
  }

  return { folderPath: input.folderPath, manifest }
}

export async function stageRestore(input: {
  backup: ValidatedBackup
  userDataPath: string
  now: number
}): Promise<void> {
  const staging = join(input.userDataPath, STAGING_DIR)
  const pending = join(input.userDataPath, PENDING_DIR)
  await rm(staging, { recursive: true, force: true })
  await rm(pending, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })

  try {
    await cp(join(input.backup.folderPath, 'family.db'), join(staging, 'family.db'))
    for (const directory of DATA_DIRECTORIES) {
      const source = join(input.backup.folderPath, directory)
      if (existsSync(source)) await cp(source, join(staging, directory), { recursive: true })
    }
    // The marker is written last: a staged restore without it is incomplete and ignored.
    await writeFile(join(staging, MARKER_FILE), JSON.stringify({
      stagedAt: input.now,
      backupCreatedAt: input.backup.manifest.createdAt,
      backupAppVersion: input.backup.manifest.appVersion,
    }, null, 2), 'utf8')
    await rename(staging, pending)
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export type PendingRestoreOutcome =
  | { status: 'none' }
  | { status: 'applied' }
  | { status: 'failed'; message: string }

async function moveIfPresent(from: string, to: string): Promise<boolean> {
  if (!existsSync(from)) return false
  try {
    await rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await cp(from, to, { recursive: true })
    await rm(from, { recursive: true, force: true })
  }
  return true
}

export async function applyPendingRestore(input: {
  userDataPath: string
  databasePath: string
}): Promise<PendingRestoreOutcome> {
  const staging = join(input.userDataPath, STAGING_DIR)
  const pending = join(input.userDataPath, PENDING_DIR)
  await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  if (!existsSync(pending)) return { status: 'none' }
  if (!existsSync(join(pending, MARKER_FILE)) || !existsSync(join(pending, 'family.db'))) {
    await rm(pending, { recursive: true, force: true }).catch(() => undefined)
    return { status: 'none' }
  }

  const safety = join(input.userDataPath, SAFETY_DIR)
  const livePaths = [
    { live: input.databasePath, safetyName: 'family.db' },
    ...SQLITE_SIDE_FILES.map((suffix) => ({ live: `${input.databasePath}${suffix}`, safetyName: `family.db${suffix}` })),
    ...DATA_DIRECTORIES.map((directory) => ({ live: join(input.userDataPath, directory), safetyName: directory })),
  ]
  const movedToSafety: Array<{ live: string; safety: string }> = []
  const movedIntoPlace: string[] = []

  try {
    await rm(safety, { recursive: true, force: true })
    await mkdir(safety, { recursive: true })
    for (const { live, safetyName } of livePaths) {
      const target = join(safety, safetyName)
      if (await moveIfPresent(live, target)) movedToSafety.push({ live, safety: target })
    }

    if (await moveIfPresent(join(pending, 'family.db'), input.databasePath)) movedIntoPlace.push(input.databasePath)
    for (const directory of DATA_DIRECTORIES) {
      const target = join(input.userDataPath, directory)
      if (await moveIfPresent(join(pending, directory), target)) movedIntoPlace.push(target)
    }

    await rm(pending, { recursive: true, force: true })
    return { status: 'applied' }
  } catch (error) {
    for (const path of movedIntoPlace) await rm(path, { recursive: true, force: true }).catch(() => undefined)
    for (const { live, safety: saved } of movedToSafety) await moveIfPresent(saved, live).catch(() => undefined)
    await rm(pending, { recursive: true, force: true }).catch(() => undefined)
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'The backup could not be restored.',
    }
  }
}
