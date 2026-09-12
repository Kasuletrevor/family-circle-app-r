import type { DatabaseSync } from 'node:sqlite'
import type { AuthUser } from '../../shared/desktopApi'
import type { StoryAiStatusSource, StoryEmbeddingRuntime, StoryNomicClient } from './StoryIndexService'
import { StoryChunkRepository } from './StoryChunkRepository'
import { StoryHistoryRepository } from './StoryHistoryRepository'
import { StoryIndexService } from './StoryIndexService'
import { StoryMediaRepository } from './StoryMediaRepository'
import {
  StoryMediaService,
  type StoryMediaOpenPort,
  type StoryMediaPicker,
  type StoryMediaSessionSource,
} from './StoryMediaService'
import { StoryMediaStore } from './StoryMediaStore'
import { StoryRepository } from './StoryRepository'
import { StoryService, type StorySessionSource } from './StoryService'
import { OfflineVoiceAssetService } from '../voice/OfflineVoiceAssetService'
import { VoiceTranscriptionService } from '../voice/VoiceTranscriptionService'

interface CreateStoryServicesDependencies {
  db: DatabaseSync
  sessions: StorySessionSource & StoryMediaSessionSource
  userDataPath: string
  voiceManifestPath: string
  runtime: StoryEmbeddingRuntime
  nomic: StoryNomicClient
  privateAiAssets: StoryAiStatusSource
  picker: StoryMediaPicker
  opener: StoryMediaOpenPort
}

export interface StoryServices {
  storyService: StoryService
  storyIndexService: StoryIndexService
  storyMediaService: StoryMediaService
  voiceAssetService: OfflineVoiceAssetService
  voiceTranscriptionService: VoiceTranscriptionService
}

export function createStoryServices(dependencies: CreateStoryServicesDependencies): StoryServices {
  const history = new StoryHistoryRepository(dependencies.db)
  const repository = new StoryRepository(dependencies.db, history)
  const chunks = new StoryChunkRepository(dependencies.db)
  const storyIndexService = new StoryIndexService({
    repository,
    chunks,
    runtime: dependencies.runtime,
    nomic: dependencies.nomic,
    assets: dependencies.privateAiAssets,
  })
  const storyService = new StoryService({
    session: dependencies.sessions,
    repository,
    history,
    index: storyIndexService,
  })

  const mediaRepository = new StoryMediaRepository(dependencies.db)
  const mediaStore = new StoryMediaStore(dependencies.userDataPath)
  const storyMediaService = new StoryMediaService({
    session: dependencies.sessions,
    picker: dependencies.picker,
    repository: mediaRepository,
    fileStore: mediaStore,
    opener: dependencies.opener,
  })

  const voiceAssetService = new OfflineVoiceAssetService({
    userDataPath: dependencies.userDataPath,
    manifestPath: dependencies.voiceManifestPath,
  })
  const voiceTranscriptionService = new VoiceTranscriptionService({
    userDataPath: dependencies.userDataPath,
    assets: voiceAssetService,
  })

  return {
    storyService,
    storyIndexService,
    storyMediaService,
    voiceAssetService,
    voiceTranscriptionService,
  }
}

interface PendingIndexSession {
  restore(): Promise<Pick<AuthUser, 'id'> | null>
}

interface PendingVaultIndex {
  indexPendingDocuments(localUserId: number): Promise<void>
}

interface PendingStoryIndex {
  indexPendingFields(localUserId: number): Promise<void>
}

export async function retryPendingPrivateIndexes(
  sessions: PendingIndexSession,
  vault: PendingVaultIndex,
  story: PendingStoryIndex,
): Promise<void> {
  const current = await sessions.restore()
  if (!current) return
  await Promise.allSettled([
    vault.indexPendingDocuments(current.id),
    story.indexPendingFields(current.id),
  ])
}
