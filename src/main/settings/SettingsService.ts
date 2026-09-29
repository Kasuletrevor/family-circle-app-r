import { existsSync } from 'node:fs'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthUser, LocalBackupResult, LocalRestoreResult } from '../../shared/desktopApi'
import { noMutationLock, type MutationLock } from '../storage/MutationLock'
import { stageRestore, validateBackupFolder } from './LocalBackupRestore'

export interface SettingsBackupPicker {
  chooseDestination(): Promise<string | null>
}

export interface SettingsFolderOpener {
  open(path: string): Promise<void>
}

export interface SettingsRestoreHost {
  chooseBackupFolder(): Promise<string | null>
  /** Restarts the app so the staged restore is applied before the database opens. */
  scheduleRelaunch(): void
}

interface SettingsServiceDependencies {
  db: DatabaseSync
  userDataPath: string
  appVersion: string
  picker: SettingsBackupPicker
  folderOpener: SettingsFolderOpener
  restoreHost: SettingsRestoreHost
  session: { restore(): Promise<AuthUser | null> }
  now?: () => number
  mutationLock?: MutationLock
}

interface LocalBackupManifest {
  formatVersion: 1
  createdAt: number
  appVersion: string
  includes: ['database', 'vault', 'story']
  excludes: ['private-ai', 'protected-session']
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function backupFolderName(createdAt: number): string {
  return `Family Circle Backup ${new Date(createdAt).toISOString().replace(/[:.]/g, '-')}`
}

async function copyDirectoryIfPresent(source: string, destination: string): Promise<void> {
  if (!existsSync(source)) return
  await cp(source, destination, { recursive: true, force: false, errorOnExist: true })
}

export class SettingsService {
  private readonly now: () => number

  constructor(private readonly dependencies: SettingsServiceDependencies) {
    this.now = dependencies.now ?? Date.now
  }

  async createBackup(): Promise<LocalBackupResult> {
    const mutationLock = this.dependencies.mutationLock ?? noMutationLock
    return mutationLock.runExclusive(() => this.createBackupSnapshot())
  }

  async openDataFolder(): Promise<{ success: true }> {
    const current = await this.dependencies.session.restore()
    if (!current) throw new Error('Sign in before opening the Family Circle data folder.')
    await this.dependencies.folderOpener.open(this.dependencies.userDataPath)
    return { success: true }
  }

  async restoreBackup(): Promise<LocalRestoreResult> {
    const mutationLock = this.dependencies.mutationLock ?? noMutationLock
    const result = await mutationLock.runExclusive(() => this.stageBackupRestore())
    if (!result.canceled) this.dependencies.restoreHost.scheduleRelaunch()
    return result
  }

  private async stageBackupRestore(): Promise<LocalRestoreResult> {
    const current = await this.dependencies.session.restore()
    if (!current) throw new Error('Sign in before restoring a local backup.')
    this.requireSingleAccountProfile(current, 'Restoring a backup is available only when this Windows profile contains one Family Circle account.')

    const folderPath = await this.dependencies.restoreHost.chooseBackupFolder()
    if (!folderPath) return { canceled: true }

    const backup = await validateBackupFolder({
      folderPath,
      appVersion: this.dependencies.appVersion,
      expectedEmail: current.email,
    })
    await stageRestore({ backup, userDataPath: this.dependencies.userDataPath, now: this.now() })
    return { canceled: false, restarting: true }
  }

  private requireSingleAccountProfile(current: AuthUser, message: string): void {
    const row = this.dependencies.db.prepare('SELECT COUNT(*) AS count, MIN(id) AS only_id FROM users').get() as {
      count: number
      only_id: number | null
    } | undefined
    if (!row || Number(row.count) !== 1 || Number(row.only_id) !== current.id) throw new Error(message)
  }

  private async createBackupSnapshot(): Promise<LocalBackupResult> {
    const current = await this.dependencies.session.restore()
    if (!current) throw new Error('Sign in before creating a local backup.')
    this.requireSingleAccountProfile(current, 'Local backup is available only when this Windows profile contains one Family Circle account.')

    const destinationRoot = await this.dependencies.picker.chooseDestination()
    if (!destinationRoot) return { canceled: true, folderName: null, createdAt: null }

    const createdAt = this.now()
    const folderName = backupFolderName(createdAt)
    const backupRoot = join(destinationRoot, folderName)
    const databasePath = join(backupRoot, 'family.db')

    await mkdir(backupRoot, { recursive: false })

    try {
      this.dependencies.db.exec(`VACUUM INTO ${sqlString(databasePath)}`)
      await copyDirectoryIfPresent(join(this.dependencies.userDataPath, 'vault'), join(backupRoot, 'vault'))
      await copyDirectoryIfPresent(join(this.dependencies.userDataPath, 'story'), join(backupRoot, 'story'))

      const manifest: LocalBackupManifest = {
        formatVersion: 1,
        createdAt,
        appVersion: this.dependencies.appVersion,
        includes: ['database', 'vault', 'story'],
        excludes: ['private-ai', 'protected-session'],
      }
      await writeFile(join(backupRoot, 'backup.json'), JSON.stringify(manifest, null, 2), 'utf8')

      return {
        canceled: false,
        folderName: basename(backupRoot),
        createdAt,
      }
    } catch (error) {
      await rm(backupRoot, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }
}
