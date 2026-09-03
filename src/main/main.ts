import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
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
import { createWindowOptions } from './windowOptions'

let mainWindow: BrowserWindow | null = null
let database: DatabaseSync | null = null

function registerDesktopIpc(authService: AuthService, circleService: CircleService) {
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:get-platform', () => process.platform)
  registerAuthIpc(ipcMain, authService)
  registerCircleIpc(ipcMain, circleService)
}

async function createAppServices(): Promise<{ authService: AuthService; circleService: CircleService }> {
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

  return {
    authService: new AuthService(users, sessions, recovery, circle),
    circleService: new CircleService(sessions, users, circle),
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
  const { authService, circleService } = await createAppServices()
  registerDesktopIpc(authService, circleService)
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
