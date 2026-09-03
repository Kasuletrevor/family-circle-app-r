import type { CircleOverview } from '../../shared/desktopApi'
import type { IpcHandleRegistrar } from '../auth/authIpc'

export interface CircleIpcService {
  getOverview(): Promise<CircleOverview>
}

export function registerCircleIpc(ipc: IpcHandleRegistrar, service: CircleIpcService): void {
  ipc.handle('circle:get-overview', () => service.getOverview())
}
