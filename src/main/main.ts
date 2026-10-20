import { app, BrowserWindow, dialog, ipcMain, nativeImage, safeStorage, shell } from 'electron'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { createAngelsController, type AngelsController } from './agentic/angelsController'
import { registerAgenticIpc } from './agentic/agenticIpc'
import { createElectronPartnerViewHost } from './agentic/electronPartnerViewHost'
import { GuardianAngelCatalog } from './agentic/GuardianAngelCatalog'
import { KinKeepersConnection } from './agentic/KinKeepersConnection'
import { MyGuardianAngels } from './agentic/MyGuardianAngels'
import { PartnerViews } from './agentic/PartnerViews'
import { AiRuntimeManager } from './ai/AiRuntimeManager'
import { InteractiveAiGate } from './ai/InteractiveAiGate'
import { NomicClient } from './ai/NomicClient'
import { OfflineAiAssetService } from './ai/OfflineAiAssetService'
import { PrivateArchiveQueryService } from './ai/PrivateArchiveQueryService'
import { registerPrivateAiIpc } from './ai/privateAiIpc'
import { createPrivateAiRemoval } from './ai/privateAiRemoval'
import { QwenClient } from './ai/QwenClient'
import { AuthService } from './auth/AuthService'
import { registerAuthIpc } from './auth/authIpc'
import { PasswordRecoveryService } from './auth/PasswordRecoveryService'
import { createRecoveryMailer } from './auth/RecoveryMailer'
import { createProtectedCrypto, createSessionFile, SessionStore } from './auth/SessionStore'
import { UserRepository } from './auth/UserRepository'
import { registerCircleIpc, registerCirclePhotoIpc } from './circle/circleIpc'
import { CirclePhotoService } from './circle/CirclePhotoService'
import { CircleService } from './circle/CircleService'
import { resolveCircleApiConfig } from './circle/CircleApiConfig'
import { LegacyCircleAuthAdapter } from './circle/LegacyCircleAuthAdapter'
import { prepareDatabase, resolveDatabasePaths } from './database/database'
import { SettingsService } from './settings/SettingsService'
import { AsyncMutationLock } from './storage/MutationLock'
import { applyPendingRestore } from './settings/LocalBackupRestore'
import { registerSettingsIpc } from './settings/settingsIpc'
import { createStoryServices, retryPendingPrivateIndexes } from './story/createStoryServices'
import { StoryChunkRepository } from './story/StoryChunkRepository'
import { StoryDirectAnswerService } from './story/StoryDirectAnswerService'
import { StoryHistoryRepository } from './story/StoryHistoryRepository'
import { StoryRepository } from './story/StoryRepository'
import { registerStoryIpc } from './story/storyIpc'
import { registerSpeechIpc } from './speech/speechIpc'
import { WindowsSpeechService } from './speech/WindowsSpeechService'
import { DocumentExtractor } from './vault/DocumentExtractor'
import { VaultChunkRepository } from './vault/VaultChunkRepository'
import { VaultFileStore } from './vault/VaultFileStore'
import { VaultIndexService } from './vault/VaultIndexService'
import { registerVaultIpc } from './vault/vaultIpc'
import { VaultQueryService } from './vault/VaultQueryService'
import { VaultRepository } from './vault/VaultRepository'
import { VaultService } from './vault/VaultService'
import { createWindowOptions } from './windowOptions'

let mainWindow: BrowserWindow | null = null
let database: DatabaseSync | null = null
let aiRuntimeManager: AiRuntimeManager | null = null
let partnerViews: PartnerViews | null = null
let angels: AngelsController | null = null
// The Kin-Keepers.ai connection; its tokens stay in this process's memory only.
const angelConnection = new KinKeepersConnection({
  fetch: (input, init) => fetch(input, init),
  onChange(connection) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentic:angel-connection-changed', connection)
  },
})

/** A stable, private key for the signed-in Family Circle account, used to keep partner sign-ins apart. */
async function agenticAccountKey(sessions: SessionStore): Promise<string | null> {
  const user = await sessions.restore()
  return user ? createHash('sha256').update(`agentic:${user.id}`).digest('hex').slice(0, 16) : null
}

type StoryServices = ReturnType<typeof createStoryServices>

interface AppServices extends StoryServices {
  authService: AuthService
  circleService: CircleService
  circlePhotoService: CirclePhotoService
  vaultService: VaultService
  vaultQueryService: VaultQueryService
  privateAiService: OfflineAiAssetService
  settingsService: SettingsService
  vaultIndexService: VaultIndexService
  sessions: SessionStore
  mutationLock: AsyncMutationLock
}

function registerDesktopIpc(services: AppServices) {
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:get-platform', () => process.platform)
  registerAuthIpc(ipcMain, services.authService, {
    // A partner page signed in for this account must not keep running after sign-out.
    onSignedOut: () => {
      partnerViews?.destroyAll()
      void angelConnection.disconnect()
    },
  })
  registerCircleIpc(ipcMain, services.circleService)
  registerCirclePhotoIpc(ipcMain, services.circlePhotoService)
  registerVaultIpc(ipcMain, services.vaultService, services.vaultQueryService, services.mutationLock, (documentId) => (
    services.vaultIndexService.getIndexProgress(documentId)
  ))
  registerSettingsIpc(ipcMain, services.settingsService)
  registerSpeechIpc(ipcMain, new WindowsSpeechService({ tempPath: app.getPath('temp') }))
  registerStoryIpc(ipcMain, {
    story: services.storyService,
    media: services.storyMediaService,
    voiceAssets: services.voiceAssetService,
    transcription: services.voiceTranscriptionService,
    mutationLock: services.mutationLock,
  })
  const privateAi = services.privateAiService
  const removePrivateAi = createPrivateAiRemoval({
    mutationLock: services.mutationLock,
    stopRuntimes: async () => { await aiRuntimeManager?.stopAllAndWait() },
    removeAssets: () => privateAi.remove(),
  })
  registerPrivateAiIpc(ipcMain, {
    getStatus: () => privateAi.getStatus(),
    getVersion: () => privateAi.getVersion(),
    startSetup: (onProgress) => privateAi.startSetup(onProgress),
    pauseSetup: () => privateAi.pauseSetup(),
    repair: (onProgress) => privateAi.repair(onProgress),
    remove: removePrivateAi,
  }, () => {
    void retryPendingPrivateIndexes(
      services.sessions,
      services.vaultIndexService,
      services.storyIndexService,
    ).catch(() => undefined)
  })
  const catalog = new GuardianAngelCatalog({
    fetch: (input, init) => fetch(input, init),
    cachePath: join(app.getPath('userData'), 'agentic', 'catalog.json'),
  })
  angels = createAngelsController({
    connection: angelConnection,
    angels: new MyGuardianAngels({
      fetch: (input, init) => fetch(input, init),
      connection: angelConnection,
      async templates() {
        const result = await catalog.get()
        return result.status === 'ready' ? result.templates : []
      },
    }),
    async openPage(service, url) {
      if (!partnerViews) throw new Error('The Family Circle window is not ready')
      await partnerViews.openPage(service, url)
    },
    accountKey: () => agenticAccountKey(services.sessions),
  })
  registerAgenticIpc(ipcMain, {
    catalog,
    angels,
    views: {
      open: async (service, target) => {
        if (!partnerViews) throw new Error('The Family Circle window is not ready')
        await partnerViews.open(service, target)
      },
      setBounds: (service, bounds) => partnerViews?.setBounds(service, bounds),
      hide: (service) => partnerViews?.hide(service),
      command: (service, command) => partnerViews?.command(service, command),
    },
  })
}

async function createAppServices(): Promise<AppServices> {
  const userDataPath = app.getPath('userData')
  const appDataPath = app.getPath('appData')
  const restore = await applyPendingRestore({
    userDataPath,
    databasePath: resolveDatabasePaths({ userDataPath, appDataPath }).activePath,
  })
  if (restore.status === 'failed') {
    dialog.showErrorBox(
      'Backup was not restored',
      `Family Circle kept your existing data because the backup could not be restored.\n\n${restore.message}`,
    )
  }
  database = await prepareDatabase({
    userDataPath,
    appDataPath,
  })

  const users = new UserRepository(database)
  const sessions = new SessionStore(
    users,
    createProtectedCrypto(safeStorage),
    createSessionFile(join(userDataPath, 'protected-session.bin')),
  )
  const mailer = createRecoveryMailer()
  const recovery = new PasswordRecoveryService(database, users, mailer)
  const circle = new LegacyCircleAuthAdapter(resolveCircleApiConfig())

  const mutationLock = new AsyncMutationLock()

  const privateAiService = new OfflineAiAssetService({
    userDataPath,
    manifestPath: join(app.getAppPath(), 'config', 'offline-ai-manifest.json'),
  })
  aiRuntimeManager = new AiRuntimeManager({ assets: privateAiService })

  const settingsService = new SettingsService({
    db: database,
    userDataPath,
    appVersion: app.getVersion(),
    session: sessions,
    mutationLock,
    picker: {
      async chooseDestination() {
        const result = await dialog.showOpenDialog({
          title: 'Choose where to save your Family Circle backup',
          properties: ['openDirectory', 'createDirectory'],
        })
        return result.canceled ? null : result.filePaths[0] ?? null
      },
    },
    restoreHost: {
      async chooseBackupFolder() {
        const result = await dialog.showOpenDialog({
          title: 'Choose a Family Circle backup folder to restore',
          properties: ['openDirectory'],
        })
        return result.canceled ? null : result.filePaths[0] ?? null
      },
      scheduleRelaunch() {
        // Let the IPC reply reach the renderer before quitting; before-quit closes the database.
        setTimeout(() => {
          app.relaunch()
          app.quit()
        }, 300)
      },
    },
    folderOpener: {
      async open(path) {
        const failure = await shell.openPath(path)
        if (failure) throw new Error('Could not open the Family Circle data folder.')
      },
    },
  })

  const vaultRepository = new VaultRepository(database)
  const vaultChunkRepository = new VaultChunkRepository(database)
  const vaultFileStore = new VaultFileStore(userDataPath)
  const vaultExtractor = new DocumentExtractor()
  const nomicClient = new NomicClient()
  const interactiveAiGate = new InteractiveAiGate()
  const vaultIndexService = new VaultIndexService({
    documents: vaultRepository,
    chunks: vaultChunkRepository,
    runtime: aiRuntimeManager,
    nomic: nomicClient,
    assets: privateAiService,
    mutationLock,
    interactiveGate: interactiveAiGate,
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

  const storyServices = createStoryServices({
    db: database,
    sessions,
    userDataPath,
    voiceManifestPath: join(app.getAppPath(), 'config', 'offline-voice-manifest.json'),
    runtime: aiRuntimeManager,
    nomic: nomicClient,
    privateAiAssets: privateAiService,
    interactiveGate: interactiveAiGate,
    picker: {
      async chooseMedia(mediaType) {
        const result = await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
          filters: mediaType === 'photo'
            ? [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
            : [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm'] }],
        })
        return result.canceled ? [] : result.filePaths
      },
    },
    opener: {
      openPath: (absolutePath) => shell.openPath(absolutePath),
    },
    mutationLock,
  })

  const storyQueryHistory = new StoryHistoryRepository(database)
  const storyQueryRepository = new StoryRepository(database, storyQueryHistory)
  const storyQueryChunks = new StoryChunkRepository(database)
  const privateArchiveQueryService = new PrivateArchiveQueryService({
    session: sessions,
    documents: vaultRepository,
    vaultChunks: vaultChunkRepository,
    storyChunks: storyQueryChunks,
    runtime: aiRuntimeManager,
    nomic: nomicClient,
    qwen: new QwenClient(),
    direct: new StoryDirectAnswerService(storyQueryRepository),
    interactiveGate: interactiveAiGate,
  })
  const vaultQueryService = new VaultQueryService(privateArchiveQueryService)

  const services: AppServices = {
    authService: new AuthService(users, sessions, recovery, circle),
    circleService: new CircleService(sessions, users, circle, mailer),
    circlePhotoService: new CirclePhotoService({
      userDataPath,
      session: sessions,
      users,
      images: { fromPath: (path) => nativeImage.createFromPath(path) },
      mutationLock,
      picker: {
        async choosePhoto() {
          const result = await dialog.showOpenDialog({
            title: 'Choose a photo',
            properties: ['openFile'],
            filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png'] }],
          })
          return result.canceled ? null : result.filePaths[0] ?? null
        },
      },
    }),
    vaultService,
    vaultQueryService,
    privateAiService,
    settingsService,
    vaultIndexService,
    sessions,
    mutationLock,
    ...storyServices,
  }

  void privateAiService.getStatus().then((status) => {
    if (status.state !== 'ready') return
    return retryPendingPrivateIndexes(sessions, vaultIndexService, storyServices.storyIndexService)
  }).catch(() => undefined)

  return services
}

function createMainWindow(sessions: SessionStore) {
  const preloadPath = join(__dirname, '../preload/preload.js')
  mainWindow = new BrowserWindow(createWindowOptions(preloadPath))

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const window = mainWindow
  partnerViews = new PartnerViews({
    host: createElectronPartnerViewHost(window),
    accountKey: () => agenticAccountKey(sessions),
    emit(status) {
      if (!window.isDestroyed()) window.webContents.send('agentic:view-state', status)
    },
    interceptNavigation: (service, url) => angels?.interceptNavigation(service, url) ?? false,
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    partnerViews?.destroyAll()
    partnerViews = null
    mainWindow = null
  })
}

void app.whenReady().then(async () => {
  const services = await createAppServices()
  registerDesktopIpc(services)
  createMainWindow(services.sessions)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(services.sessions)
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