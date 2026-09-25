import type { LocalBackupResult } from '../../shared/desktopApi'
import type { IpcHandleRegistrar } from '../auth/authIpc'

export interface SettingsIpcService {
  createBackup(): Promise<LocalBackupResult>
}

export function registerSettingsIpc(ipc: IpcHandleRegistrar, service: SettingsIpcService): void {
  ipc.handle('settings:create-backup', () => service.createBackup())
}
