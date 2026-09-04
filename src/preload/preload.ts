import { contextBridge, ipcRenderer } from 'electron'
import { createDesktopApi } from './createDesktopApi'

const desktopApi = createDesktopApi(
  (channel, payload) => payload === undefined
    ? ipcRenderer.invoke(channel)
    : ipcRenderer.invoke(channel, payload),
  (channel, listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(channel, wrappedListener)
    return () => ipcRenderer.removeListener(channel, wrappedListener)
  },
)

contextBridge.exposeInMainWorld('familyCircle', desktopApi)
