import type { LocalBackupResult, LocalRestoreResult } from '../../shared/desktopApi'
import type { IpcHandleRegistrar } from '../auth/authIpc'

export interface SettingsIpcService {
  createBackup(): Promise<LocalBackupResult>
  openDataFolder(): Promise<{ success: true }>
  restoreBackup(): Promise<LocalRestoreResult>
}

export function registerSettingsIpc(ipc: IpcHandleRegistrar, service: SettingsIpcService): void {
  ipc.handle('settings:create-backup', () => service.createBackup())
  ipc.handle('settings:open-data-folder', () => service.openDataFolder())
  ipc.handle('settings:restore-backup', () => service.restoreBackup())
}
