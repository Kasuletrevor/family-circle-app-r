import type { DesktopApi } from '../../shared/desktopApi'

declare global {
  interface Window {
    familyCircle: DesktopApi
  }
}

export {}
