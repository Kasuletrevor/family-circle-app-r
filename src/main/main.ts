import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { AuthService } from './auth/AuthService'
import { registerAuthIpc } from './auth/authIpc'
import { PasswordRecoveryService } from './auth/PasswordRecoveryService'
import { createRecoveryMailer } from './auth/RecoveryMailer'
import { createProtectedCrypto, createSessionFile, SessionStore } from './auth/SessionStore'
import { UserRepository } from './auth/UserRepository'
import { registerCircleIpc } from './circle/circleIpc'
import { CircleService } from './circle/CircleService'
import { LegacyCircleAuthAdapter } from './circle/LegacyCircleAuthAdapter'
import { prepareDatabase } from './database/database'
import { DocumentExtractor } from './vault/DocumentExtractor'
import { VaultFileStore } from './vault/VaultFileStore'
import { registerVaultIpc } from './vault/vaultIpc'
import { VaultRepository } from './vault/VaultRepository'
import { VaultService } from './vault/VaultService'
import { createWindowOptions } from './windowOptions'

let mainWindow: BrowserWindow | null = null
let database: DatabaseSync | null = null

function registerDesktopIpc(authService: AuthService, circleService: CircleService, vaultService: VaultService) {
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:get-platform', () => process.platform)
  registerAuthIpc(ipcMain, authService)
  registerCircleIpc(ipcMain, circleService)
  registerVaultIpc(ipcMain, vaultService)
}

async function createAppServices(): Promise<{
  authService: AuthService
  circleService: CircleService
  vaultService: VaultService
}> {
  const userDataPath = app.getPath('userData')
  database = await prepareDatabase({
    userDataPath,
    appDataPath: app.getPath('appData'),
  })

  const users = new UserRepository(database)
  const sessions = new SessionStore(
    users,
    createProtectedCrypto(safeStorage),
    createSessionFile(join(userDataPath, 'protected-session.bin')),
  )
  const recovery = new PasswordRecoveryService(database, users, createRecoveryMailer())
  const circle = new LegacyCircleAuthAdapter({
    baseUrl: process.env.CIRCLE_API_URL || '',
    apiKey: process.env.CIRCLE_API_KEY || '',
  })
  const vaultRepository = new VaultRepository(database)
  const vaultFileStore = new VaultFileStore(userDataPath)
  const vaultExtractor = new DocumentExtractor()
  const vaultService = new VaultService({
    session: sessions,
    repository: vaultRepository,
    fileStore: vaultFileStore,
    extractor: vaultExtractor,
    picker: {
      async chooseDocuments() {
        const result = await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt'] }],
        })
        return result.canceled ? [] : result.filePaths
      },
    },
    opener: {
      openPath: (absolutePath) => shell.openPath(absolutePath),
    },
  })

  return {
    authService: new AuthService(users, sessions, recovery, circle),
    circleService: new CircleService(sessions, users, circle),
    vaultService,
  }
}

function createMainWindow() {
  const preloadPath = join(__dirname, '../preload/preload.js')
  mainWindow = new BrowserWindow(createWindowOptions(preloadPath))

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

void app.whenReady().then(async () => {
  const { authService, circleService, vaultService } = await createAppServices()
  registerDesktopIpc(authService, circleService, vaultService)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('before-quit', () => {
  database?.close()
  database = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
