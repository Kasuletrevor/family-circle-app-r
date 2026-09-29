import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../database/migrations'
import { UserRepository } from '../auth/UserRepository'
import { SettingsService } from './SettingsService'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'family-circle-settings-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('SettingsService', () => {
  it('creates a consistent local backup without Private AI or protected session files', async () => {
    const root = await tempRoot()
    const userDataPath = join(root, 'user-data')
    const destination = join(root, 'backups')
    await mkdir(join(userDataPath, 'vault', 'users', '1', 'documents'), { recursive: true })
    await mkdir(join(userDataPath, 'story', 'users', '1', 'media'), { recursive: true })
    await mkdir(join(userDataPath, 'offline-ai'), { recursive: true })
    await mkdir(destination, { recursive: true })

    await writeFile(join(userDataPath, 'vault', 'users', '1', 'documents', 'letter.txt'), 'family letter')
    await writeFile(join(userDataPath, 'story', 'users', '1', 'media', 'photo.jpg'), 'photo bytes')
    await writeFile(join(userDataPath, 'offline-ai', 'model.gguf'), 'very large model')
    await writeFile(join(userDataPath, 'protected-session.bin'), 'secret session')

    const db = new DatabaseSync(join(userDataPath, 'family.db'))
    runMigrations(db)
    const users = new UserRepository(db)
    const user = await users.createRegisteredUser({
      name: 'Ada Example',
      email: 'ada@example.test',
      password: 'correct horse battery staple',
    })

    const createdAt = Date.parse('2026-09-25T10:00:00.000Z')
    const service = new SettingsService({
      db,
      userDataPath,
      appVersion: '0.2.3',
      picker: { chooseDestination: async () => destination },
      folderOpener: { open: vi.fn(async () => undefined) },
      session: { restore: async () => user },
      now: () => createdAt,
    })

    const result = await service.createBackup()
    expect(result).toEqual({
      canceled: false,
      folderName: 'Family Circle Backup 2026-09-25T10-00-00-000Z',
      createdAt,
    })

    const backupRoot = join(destination, result.folderName!)
    await expect(stat(join(backupRoot, 'vault', 'users', '1', 'documents', 'letter.txt'))).resolves.toMatchObject({ size: 13 })
    await expect(stat(join(backupRoot, 'story', 'users', '1', 'media', 'photo.jpg'))).resolves.toMatchObject({ size: 11 })
    await expect(stat(join(backupRoot, 'offline-ai'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(backupRoot, 'protected-session.bin'))).rejects.toMatchObject({ code: 'ENOENT' })

    const manifest = JSON.parse(await readFile(join(backupRoot, 'backup.json'), 'utf8'))
    expect(manifest).toEqual({
      formatVersion: 1,
      createdAt,
      appVersion: '0.2.3',
      includes: ['database', 'vault', 'story'],
      excludes: ['private-ai', 'protected-session'],
    })

    const backupDb = new DatabaseSync(join(backupRoot, 'family.db'), { readOnly: true })
    expect(backupDb.prepare('SELECT email, name FROM users').get()).toEqual({
      email: 'ada@example.test',
      name: 'Ada Example',
    })
    backupDb.close()
    db.close()
  })

  it('refuses device-wide backup when more than one local account exists', async () => {
    const root = await tempRoot()
    const userDataPath = join(root, 'user-data')
    const destination = join(root, 'backups')
    await mkdir(userDataPath, { recursive: true })
    await mkdir(destination, { recursive: true })

    const db = new DatabaseSync(join(userDataPath, 'family.db'))
    runMigrations(db)
    const users = new UserRepository(db)
    const first = await users.createRegisteredUser({
      name: 'Ada Example',
      email: 'ada@example.test',
      password: 'correct horse battery staple',
    })
    await users.createRegisteredUser({
      name: 'Second Person',
      email: 'second@example.test',
      password: 'another secure password 123',
    })

    const chooseDestination = vi.fn(async () => destination)
    const service = new SettingsService({
      db,
      userDataPath,
      appVersion: '0.2.3',
      picker: { chooseDestination },
      folderOpener: { open: vi.fn(async () => undefined) },
      session: { restore: async () => first },
    })

    await expect(service.createBackup()).rejects.toThrow('one Family Circle account')
    expect(chooseDestination).not.toHaveBeenCalled()
    db.close()
  })

  it('returns a clean canceled result without touching disk when no destination is selected', async () => {
    const root = await tempRoot()
    const userDataPath = join(root, 'user-data')
    await mkdir(userDataPath, { recursive: true })
    const db = new DatabaseSync(join(userDataPath, 'family.db'))
    runMigrations(db)
    const users = new UserRepository(db)
    const user = await users.createRegisteredUser({
      name: 'Ada Example',
      email: 'ada@example.test',
      password: 'correct horse battery staple',
    })

    const service = new SettingsService({
      db,
      userDataPath,
      appVersion: '0.2.3',
      picker: { chooseDestination: async () => null },
      folderOpener: { open: vi.fn(async () => undefined) },
      session: { restore: async () => user },
    })

    await expect(service.createBackup()).resolves.toEqual({
      canceled: true,
      folderName: null,
      createdAt: null,
    })
    db.close()
  })

  it('opens the Family Circle data folder only for a signed-in user', async () => {
    const open = vi.fn(async () => undefined)
    const user = { id: 1, email: 'ada@example.test', name: 'Ada', accountOrigin: 'registered' as const, mustChangePassword: false, onboardingCompleted: true }
    const restore = vi.fn(async () => user as typeof user | null)
    const service = new SettingsService({
      db: {} as never,
      userDataPath: 'C:/private/family-circle',
      appVersion: '0.2.3',
      picker: { chooseDestination: async () => null },
      folderOpener: { open },
      session: { restore },
    })

    await expect(service.openDataFolder()).resolves.toEqual({ success: true })
    expect(open).toHaveBeenCalledWith('C:/private/family-circle')

    restore.mockResolvedValueOnce(null)
    await expect(service.openDataFolder()).rejects.toThrow('Sign in before opening the Family Circle data folder.')
    expect(open).toHaveBeenCalledTimes(1)
  })
})
