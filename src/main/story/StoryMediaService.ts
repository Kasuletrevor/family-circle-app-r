import { basename } from 'node:path'
import type { AuthUser } from '../../shared/desktopApi'
import { requireStoryField, type StoryFieldKey } from '../../shared/story'
import type { StoryMediaInternal, InsertActiveStoryMediaInput } from './StoryMediaRepository'
import type { StoryMediaType, ValidatedStoryMedia } from './StoryMediaStore'

export interface StoryMediaSessionSource {
  restore(): Promise<AuthUser | null>
}

export interface StoryMediaPicker {
  chooseMedia(mediaType: StoryMediaType): Promise<string[]>
}

export interface StoryMediaOpenPort {
  openPath(absolutePath: string): Promise<string>
}

export interface StoryMediaFileStorePort {
  validateSelected(filePath: string, expectedType: StoryMediaType): Promise<ValidatedStoryMedia>
  copyIntoStory(localUserId: number, sourcePath: string, extension: string): Promise<string>
  resolveOwnedPath(localUserId: number, storedRelativePath: string): string
  deleteOwnedFile(localUserId: number, storedRelativePath: string): Promise<void>
}

export interface StoryMediaRepositoryPort {
  insertActive(input: InsertActiveStoryMediaInput): Promise<StoryMediaInternal>
  listByUser(localUserId: number): Promise<StoryMediaInternal[]>
  getByIdForUser(localUserId: number, mediaId: number): Promise<StoryMediaInternal | null>
  deleteByIdForUser(localUserId: number, mediaId: number): Promise<boolean>
}

export interface StoryMediaPublicItem {
  id: number
  fieldKey: StoryFieldKey
  mediaType: StoryMediaType
  fileName: string
  mimeType: string
  sizeBytes: number
  createdAt: number
}

export type StoryMediaAddOutcome = 'unsupported' | 'too-large' | 'failed'
export interface StoryMediaAddFailure {
  fileName: string
  outcome: StoryMediaAddOutcome
}

export interface StoryMediaAddResult {
  canceled: boolean
  items: Array<StoryMediaPublicItem | StoryMediaAddFailure>
}

interface StoryMediaServiceDependencies {
  session: StoryMediaSessionSource
  picker: StoryMediaPicker
  repository: StoryMediaRepositoryPort
  fileStore: StoryMediaFileStorePort
  opener: StoryMediaOpenPort
}

type StoryMediaServiceErrorCode =
  | 'unauthenticated'
  | 'invalid-input'
  | 'too-many'
  | 'not-found'
  | 'open-failed'
  | 'delete-failed'

export class StoryMediaServiceError extends Error {
  constructor(public readonly code: StoryMediaServiceErrorCode, message: string) {
    super(message)
    this.name = 'StoryMediaServiceError'
  }
}

function publicItem(row: StoryMediaInternal): StoryMediaPublicItem {
  return {
    id: row.id,
    fieldKey: row.fieldKey,
    mediaType: row.mediaType,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
  }
}

function safeMediaType(value: unknown): StoryMediaType {
  if (value !== 'photo' && value !== 'audio') {
    throw new StoryMediaServiceError('invalid-input', 'Invalid Story media type')
  }
  return value
}

function safeFieldKey(value: unknown): StoryFieldKey {
  try {
    return requireStoryField(value).key
  } catch {
    throw new StoryMediaServiceError('invalid-input', 'Invalid Story field')
  }
}

function safeMediaId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new StoryMediaServiceError('not-found', 'Story media not found')
  }
  return Number(value)
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export class StoryMediaService {
  constructor(private readonly dependencies: StoryMediaServiceDependencies) {}

  async chooseAndAdd(input: { fieldKey: StoryFieldKey; mediaType: StoryMediaType }): Promise<StoryMediaAddResult> {
    const user = await this.requireUser()
    const fieldKey = safeFieldKey(input?.fieldKey)
    const mediaType = safeMediaType(input?.mediaType)
    const sourcePaths = await this.dependencies.picker.chooseMedia(mediaType)
    if (sourcePaths.length === 0) return { canceled: true, items: [] }
    if (sourcePaths.length > 8) throw new StoryMediaServiceError('too-many', 'Choose at most eight Story media files at a time')

    const items: StoryMediaAddResult['items'] = []
    for (const sourcePath of sourcePaths) {
      const fileName = basename(sourcePath)
      try {
        const validated = await this.dependencies.fileStore.validateSelected(sourcePath, mediaType)
        let storedRelativePath: string
        try {
          storedRelativePath = await this.dependencies.fileStore.copyIntoStory(user.id, sourcePath, validated.extension)
        } catch {
          items.push({ fileName, outcome: 'failed' })
          continue
        }

        try {
          const row = await this.dependencies.repository.insertActive({
            localUserId: user.id,
            fieldKey,
            mediaType,
            fileName,
            mimeType: validated.mimeType,
            sizeBytes: validated.sizeBytes,
            storedRelativePath,
          })
          items.push(publicItem(row))
        } catch {
          try {
            await this.dependencies.fileStore.deleteOwnedFile(user.id, storedRelativePath)
          } catch {
            // No active database row exists; preserve the stable add failure.
          }
          items.push({ fileName, outcome: 'failed' })
        }
      } catch (error) {
        const code = errorCode(error)
        items.push({
          fileName,
          outcome: code === 'unsupported' ? 'unsupported' : code === 'too-large' ? 'too-large' : 'failed',
        })
      }
    }
    return { canceled: false, items }
  }

  async list(): Promise<StoryMediaPublicItem[]> {
    const user = await this.requireUser()
    return (await this.dependencies.repository.listByUser(user.id)).map(publicItem)
  }

  async open(input: { mediaId: number }): Promise<{ success: true }> {
    const user = await this.requireUser()
    const mediaId = safeMediaId(input?.mediaId)
    const row = await this.dependencies.repository.getByIdForUser(user.id, mediaId)
    if (!row) throw new StoryMediaServiceError('not-found', 'Story media not found')
    try {
      const absolutePath = this.dependencies.fileStore.resolveOwnedPath(user.id, row.storedRelativePath)
      const openError = await this.dependencies.opener.openPath(absolutePath)
      if (openError) throw new Error('open')
      return { success: true }
    } catch {
      throw new StoryMediaServiceError('open-failed', 'Story media could not be opened')
    }
  }

  async delete(input: { mediaId: number }): Promise<{ success: true }> {
    const user = await this.requireUser()
    const mediaId = safeMediaId(input?.mediaId)
    const row = await this.dependencies.repository.getByIdForUser(user.id, mediaId)
    if (!row) throw new StoryMediaServiceError('not-found', 'Story media not found')
    try {
      await this.dependencies.fileStore.deleteOwnedFile(user.id, row.storedRelativePath)
      const deleted = await this.dependencies.repository.deleteByIdForUser(user.id, mediaId)
      if (!deleted) throw new Error('delete')
      return { success: true }
    } catch {
      throw new StoryMediaServiceError('delete-failed', 'Story media could not be deleted')
    }
  }

  private async requireUser(): Promise<AuthUser> {
    const user = await this.dependencies.session.restore()
    if (!user) throw new StoryMediaServiceError('unauthenticated', 'Sign in to access My Story')
    return user
  }
}
