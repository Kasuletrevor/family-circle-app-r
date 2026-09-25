import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
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
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    db.prepare('INSERT INTO sample (value) VALUES (?)').run('kept in backup')

    const createdAt = Date.parse('2026-09-25T10:00:00.000Z')
    const service = new SettingsService({
      db,
      userDataPath,
      appVersion: '0.2.3',
      picker: { chooseDestination: async () => destination },
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
    expect(backupDb.prepare('SELECT value FROM sample').get()).toEqual({ value: 'kept in backup' })
    backupDb.close()
    db.close()
  })

  it('returns a clean canceled result without touching disk when no destination is selected', async () => {
    const root = await tempRoot()
    const userDataPath = join(root, 'user-data')
    await mkdir(userDataPath, { recursive: true })
    const db = new DatabaseSync(join(userDataPath, 'family.db'))
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY)')

    const service = new SettingsService({
      db,
      userDataPath,
      appVersion: '0.2.3',
      picker: { chooseDestination: async () => null },
    })

    await expect(service.createBackup()).resolves.toEqual({
      canceled: true,
      folderName: null,
      createdAt: null,
    })
    db.close()
  })
})
