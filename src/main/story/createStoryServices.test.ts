import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../database/migrations'
import { createStoryServices, retryPendingPrivateIndexes } from './createStoryServices'

const databases: DatabaseSync[] = []

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  runMigrations(db)
  return db
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

describe('createStoryServices', () => {
  it('composes Story lifecycle/media/voice services with the shared AI runtime, Nomic client, and Private AI assets only', () => {
    const db = database()
    const sessions = { restore: vi.fn(async () => null) }
    const runtime = { ensureEmbeddingRuntime: vi.fn(async () => true) }
    const nomic = { embedDocument: vi.fn(async () => new Float32Array([1, 0])) }
    const privateAiAssets = { getStatus: vi.fn(async () => ({ state: 'ready' })) }
    const picker = { chooseMedia: vi.fn(async () => []) }
    const opener = { openPath: vi.fn(async () => '') }

    const services = createStoryServices({
      db,
      sessions,
      userDataPath: 'C:/private/family-circle',
      voiceManifestPath: 'C:/app/config/offline-voice-manifest.json',
      runtime,
      nomic,
      privateAiAssets,
      picker,
      opener,
    })

    expect(services.storyService).toBeTruthy()
    expect(services.storyMediaService).toBeTruthy()
    expect(services.storyIndexService).toBeTruthy()
    expect(services.voiceAssetService).toBeTruthy()
    expect(services.voiceTranscriptionService).toBeTruthy()

    const indexDependencies = (services.storyIndexService as unknown as { dependencies: Record<string, unknown> }).dependencies
    expect(indexDependencies.runtime).toBe(runtime)
    expect(indexDependencies.nomic).toBe(nomic)
    expect(indexDependencies.assets).toBe(privateAiAssets)

    const lifecycleDependencies = (services.storyService as unknown as { dependencies: Record<string, unknown> }).dependencies
    expect(lifecycleDependencies.session).toBe(sessions)
    const mediaDependencies = (services.storyMediaService as unknown as { dependencies: Record<string, unknown> }).dependencies
    expect(mediaDependencies.session).toBe(sessions)
    expect(mediaDependencies.picker).toBe(picker)
    expect(mediaDependencies.opener).toBe(opener)
  })

  it('retries both Vault and Story pending indexes for the restored user and isolates either retry failure', async () => {
    const sessions = { restore: vi.fn(async () => ({ id: 42 })) }
    const vault = { indexPendingDocuments: vi.fn(async () => { throw new Error('vault failed') }) }
    const story = { indexPendingFields: vi.fn(async () => undefined) }

    await retryPendingPrivateIndexes(sessions, vault, story)

    expect(vault.indexPendingDocuments).toHaveBeenCalledWith(42)
    expect(story.indexPendingFields).toHaveBeenCalledWith(42)

    sessions.restore.mockResolvedValueOnce(null)
    await retryPendingPrivateIndexes(sessions, vault, story)
    expect(vault.indexPendingDocuments).toHaveBeenCalledTimes(1)
    expect(story.indexPendingFields).toHaveBeenCalledTimes(1)
  })

  it('keeps Story composition free of Circle transport and wires Story IPC plus both AI-ready retry hooks in main', () => {
    const factorySource = readFileSync(resolve(__dirname, 'createStoryServices.ts'), 'utf8')
    const mainSource = readFileSync(resolve(__dirname, '../main.ts'), 'utf8')

    expect(factorySource).not.toMatch(/LegacyCircle|circle\/|CircleService|CIRCLE_API/i)
    expect(mainSource).toContain("import { createStoryServices, retryPendingPrivateIndexes } from './story/createStoryServices'")
    expect(mainSource).toContain("import { registerStoryIpc } from './story/storyIpc'")
    expect(mainSource).toMatch(/registerStoryIpc\(ipcMain,\s*\{[\s\S]*?story:/)
    expect(mainSource.match(/retryPendingPrivateIndexes\(/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
