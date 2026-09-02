import { contextBridge, ipcRenderer } from 'electron'
import { createDesktopApi } from './createDesktopApi'

const desktopApi = createDesktopApi((channel) => ipcRenderer.invoke(channel))

contextBridge.exposeInMainWorld('familyCircle', desktopApi)
