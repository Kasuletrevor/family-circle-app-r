import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../database/migrations'
import { UserRepository } from '../auth/UserRepository'
import { applyPendingRestore, stageRestore, validateBackupFolder } from './LocalBackupRestore'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'family-circle-restore-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function writeDatabase(path: string, emails: string[]): Promise<void> {
  const db = new DatabaseSync(path)
  runMigrations(db)
  const users = new UserRepository(db)
  for (const email of emails) {
    await users.createRegisteredUser({ name: 'Ada Example', email, password: 'correct horse battery staple' })
  }
  db.close()
}

async function makeBackup(root: string, options: {
  emails?: string[]
  manifest?: Record<string, unknown> | null
  vaultText?: string
} = {}): Promise<string> {
  const folder = join(root, 'Family Circle Backup')
  await mkdir(join(folder, 'vault', 'users', '1', 'documents'), { recursive: true })
  await mkdir(join(folder, 'story', 'users', '1', 'media'), { recursive: true })
  await writeFile(join(folder, 'vault', 'users', '1', 'documents', 'letter.txt'), options.vaultText ?? 'backup letter')
  await writeFile(join(folder, 'story', 'users', '1', 'media', 'photo.jpg'), 'backup photo')
  await writeDatabase(join(folder, 'family.db'), options.emails ?? ['ada@example.test'])
  if (options.manifest !== null) {
    await writeFile(join(folder, 'backup.json'), JSON.stringify(options.manifest ?? {
      formatVersion: 1,
      createdAt: 1000,
      appVersion: '0.2.3',
      includes: ['database', 'vault', 'story'],
      excludes: ['private-ai', 'protected-session'],
    }))
  }
  return folder
}

async function makeLiveData(userDataPath: string): Promise<string> {
  await mkdir(join(userDataPath, 'vault', 'users', '1', 'documents'), { recursive: true })
  await mkdir(join(userDataPath, 'story'), { recursive: true })
  await mkdir(join(userDataPath, 'offline-ai'), { recursive: true })
  await writeFile(join(userDataPath, 'vault', 'users', '1', 'documents', 'letter.txt'), 'current letter')
  await writeFile(join(userDataPath, 'offline-ai', 'model.gguf'), 'model')
  await writeFile(join(userDataPath, 'protected-session.bin'), 'session')
  const databasePath = join(userDataPath, 'family.db')
  await writeDatabase(databasePath, ['ada@example.test'])
  await writeFile(`${databasePath}-wal`, 'stale wal')
  return databasePath
}

describe('validateBackupFolder', () => {
  it('accepts a backup of the same account regardless of email case', async () => {
    const folder = await makeBackup(await tempRoot())
    await expect(validateBackupFolder({ folderPath: folder, appVersion: '0.2.3', expectedEmail: 'ADA@example.test' }))
      .resolves.toMatchObject({ folderPath: folder, manifest: { formatVersion: 1 } })
  })

  it('rejects folders that are not Family Circle backups', async () => {
    const root = await tempRoot()
    const noManifest = await makeBackup(root, { manifest: null })
    await expect(validateBackupFolder({ folderPath: noManifest, appVersion: '0.2.3', expectedEmail: 'ada@example.test' }))
      .rejects.toThrow('not a Family Circle backup')

    const wrongFormat = await makeBackup(await tempRoot(), { manifest: { formatVersion: 2, includes: ['database'], appVersion: '0.2.3' } })
    await expect(validateBackupFolder({ folderPath: wrongFormat, appVersion: '0.2.3', expectedEmail: 'ada@example.test' }))
      .rejects.toThrow('not a Family Circle backup')
  })

  it('rejects backups from a newer app version', async () => {
    const folder = await makeBackup(await tempRoot(), {
      manifest: { formatVersion: 1, createdAt: 1, appVersion: '0.3.0', includes: ['database', 'vault', 'story'] },
    })
    await expect(validateBackupFolder({ folderPath: folder, appVersion: '0.2.9', expectedEmail: 'ada@example.test' }))
      .rejects.toThrow('newer version of Family Circle')
  })

  it('rejects backups of a different account or with several accounts', async () => {
    const other = await makeBackup(await tempRoot(), { emails: ['someone@example.test'] })
    await expect(validateBackupFolder({ folderPath: other, appVersion: '0.2.3', expectedEmail: 'ada@example.test' }))
      .rejects.toThrow('belongs to a different Family Circle account')

    const shared = await makeBackup(await tempRoot(), { emails: ['ada@example.test', 'second@example.test'] })
    await expect(validateBackupFolder({ folderPath: shared, appVersion: '0.2.3', expectedEmail: 'ada@example.test' }))
      .rejects.toThrow('exactly one Family Circle account')
  })
})

describe('stageRestore and applyPendingRestore', () => {
  it('replaces live data with the backup and keeps the previous data as a safety copy', async () => {
    const root = await tempRoot()
    const userDataPath = join(root, 'user-data')
    const databasePath = await makeLiveData(userDataPath)
    const backupFolder = await makeBackup(root)
    const backup = await validateBackupFolder({ folderPath: backupFolder, appVersion: '0.2.3', expectedEmail: 'ada@example.test' })

    await stageRestore({ backup, userDataPath, now: 5000 })
    await expect(stat(join(userDataPath, 'pending-restore', 'restore.json'))).resolves.toBeTruthy()
    // Staging never touches live data.
    await expect(readFile(join(userDataPath, 'vault', 'users', '1', 'documents', 'letter.txt'), 'utf8')).resolves.toBe('current letter')

    await expect(applyPendingRestore({ userDataPath, databasePath })).resolves.toEqual({ status: 'applied' })

    await expect(readFile(join(userDataPath, 'vault', 'users', '1', 'documents', 'letter.txt'), 'utf8')).resolves.toBe('backup letter')
    await expect(readFile(join(userDataPath, 'story', 'users', '1', 'media', 'photo.jpg'), 'utf8')).resolves.toBe('backup photo')
    await expect(stat(`${databasePath}-wal`)).rejects.toMatchObject({ code: 'ENOENT' })
    const restored = new DatabaseSync(databasePath, { readOnly: true })
    expect(restored.prepare('SELECT email FROM users').get()).toEqual({ email: 'ada@example.test' })
    restored.close()

    await expect(readFile(join(userDataPath, 'pre-restore', 'vault', 'users', '1', 'documents', 'letter.txt'), 'utf8'))
      .resolves.toBe('current letter')
    await expect(readFile(join(userDataPath, 'pre-restore', 'family.db-wal'), 'utf8')).resolves.toBe('stale wal')
    // Files outside the backup scope are untouched.
    await expect(readFile(join(userDataPath, 'offline-ai', 'model.gguf'), 'utf8')).resolves.toBe('model')
    await expect(readFile(join(userDataPath, 'protected-session.bin'), 'utf8')).resolves.toBe('session')
    await expect(stat(join(userDataPath, 'pending-restore'))).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(applyPendingRestore({ userDataPath, databasePath })).resolves.toEqual({ status: 'none' })
  })

  it('ignores an incomplete staged restore that has no marker', async () => {
    const root = await tempRoot()
    const userDataPath = join(root, 'user-data')
    const databasePath = await makeLiveData(userDataPath)
    await mkdir(join(userDataPath, 'pending-restore'), { recursive: true })
    await writeFile(join(userDataPath, 'pending-restore', 'family.db'), 'partial copy')

    await expect(applyPendingRestore({ userDataPath, databasePath })).resolves.toEqual({ status: 'none' })
    await expect(readFile(join(userDataPath, 'vault', 'users', '1', 'documents', 'letter.txt'), 'utf8')).resolves.toBe('current letter')
    await expect(stat(join(userDataPath, 'pending-restore'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rolls back to the original data when the swap fails part-way', async () => {
    const root = await tempRoot()
    const userDataPath = join(root, 'user-data')
    const databasePath = await makeLiveData(userDataPath)
    const backup = await validateBackupFolder({
      folderPath: await makeBackup(root),
      appVersion: '0.2.3',
      expectedEmail: 'ada@example.test',
    })
    await stageRestore({ backup, userDataPath, now: 5000 })
    // Vault and Story move to the safety copy first; moving the staged database into a
    // missing directory then fails, which must put the original data back.
    const blockedDatabasePath = join(userDataPath, 'missing-parent', 'family.db')

    const outcome = await applyPendingRestore({ userDataPath, databasePath: blockedDatabasePath })
    expect(outcome.status).toBe('failed')

    await expect(readFile(join(userDataPath, 'vault', 'users', '1', 'documents', 'letter.txt'), 'utf8')).resolves.toBe('current letter')
    await expect(stat(databasePath)).resolves.toBeTruthy()
    await expect(stat(join(userDataPath, 'pending-restore'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
