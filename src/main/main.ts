import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { AiRuntimeManager } from './ai/AiRuntimeManager'
import { NomicClient } from './ai/NomicClient'
import { OfflineAiAssetService } from './ai/OfflineAiAssetService'
import { registerPrivateAiIpc } from './ai/privateAiIpc'
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
import { VaultChunkRepository } from './vault/VaultChunkRepository'
import { VaultFileStore } from './vault/VaultFileStore'
import { VaultIndexService } from './vault/VaultIndexService'
import { registerVaultIpc } from './vault/vaultIpc'
import { VaultRepository } from './vault/VaultRepository'
import { VaultService } from './vault/VaultService'
import { createWindowOptions } from './windowOptions'

let mainWindow: BrowserWindow | null = null
let database: DatabaseSync | null = null
let aiRuntimeManager: AiRuntimeManager | null = null

interface AppServices {
  authService: AuthService
  circleService: CircleService
  vaultService: VaultService
  privateAiService: OfflineAiAssetService
  vaultIndexService: VaultIndexService
  sessions: SessionStore
}

function registerDesktopIpc(services: AppServices) {
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:get-platform', () => process.platform)
  registerAuthIpc(ipcMain, services.authService)
  registerCircleIpc(ipcMain, services.circleService)
  registerVaultIpc(ipcMain, services.vaultService)
  registerPrivateAiIpc(ipcMain, services.privateAiService, () => {
    void services.sessions.restore().then((current) => {
      if (current) void services.vaultIndexService.indexPendingDocuments(current.id)
    }).catch(() => undefined)
  })
}

async function createAppServices(): Promise<AppServices> {
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

  const privateAiService = new OfflineAiAssetService({
    userDataPath,
    manifestPath: join(app.getAppPath(), 'config', 'offline-ai-manifest.json'),
  })
  aiRuntimeManager = new AiRuntimeManager({ assets: privateAiService })

  const vaultRepository = new VaultRepository(database)
  const vaultChunkRepository = new VaultChunkRepository(database)
  const vaultFileStore = new VaultFileStore(userDataPath)
  const vaultExtractor = new DocumentExtractor()
  const vaultIndexService = new VaultIndexService({
    documents: vaultRepository,
    chunks: vaultChunkRepository,
    runtime: aiRuntimeManager,
    nomic: new NomicClient(),
    assets: privateAiService,
  })
  const vaultService = new VaultService({
    session: sessions,
    repository: vaultRepository,
    fileStore: vaultFileStore,
    extractor: vaultExtractor,
    indexQueue: vaultIndexService,
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

  const services: AppServices = {
    authService: new AuthService(users, sessions, recovery, circle),
    circleService: new CircleService(sessions, users, circle),
    vaultService,
    privateAiService,
    vaultIndexService,
    sessions,
  }

  void privateAiService.getStatus().then(async (status) => {
    if (status.state !== 'ready') return
    const current = await sessions.restore()
    if (current) void vaultIndexService.indexPendingDocuments(current.id)
  }).catch(() => undefined)

  return services
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
  const services = await createAppServices()
  registerDesktopIpc(services)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('before-quit', () => {
  aiRuntimeManager?.stopAll()
  aiRuntimeManager = null
  database?.close()
  database = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
