import type { DesktopApi } from '../shared/desktopApi'

type DesktopChannel = 'app:get-version' | 'app:get-platform'
type Invoke = (channel: DesktopChannel) => Promise<unknown>

export function createDesktopApi(invoke: Invoke): DesktopApi {
  return {
    app: {
      async getVersion() {
        return String(await invoke('app:get-version'))
      },
      async getPlatform() {
        return String(await invoke('app:get-platform')) as NodeJS.Platform
      },
    },
  }
}
