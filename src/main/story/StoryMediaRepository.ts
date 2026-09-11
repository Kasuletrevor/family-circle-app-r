import type { DatabaseSync } from 'node:sqlite'
import type { StoryFieldKey } from '../../shared/story'
import type { StoryMediaType } from './StoryMediaStore'

export type StoryMediaStorageStatus = 'copying' | 'active'

export interface StoryMediaInternal {
  id: number
  localUserId: number
  fieldKey: StoryFieldKey
  mediaType: StoryMediaType
  fileName: string
  mimeType: string
  sizeBytes: number
  storedRelativePath: string
  storageStatus: StoryMediaStorageStatus
  legacySourceKey: string | null
  createdAt: number
}

export interface InsertActiveStoryMediaInput {
  localUserId: number
  fieldKey: StoryFieldKey
  mediaType: StoryMediaType
  fileName: string
  mimeType: string
  sizeBytes: number
  storedRelativePath: string
}

interface StoryMediaRow {
  id: number
  local_user_id: number
  field_key: StoryFieldKey
  media_type: StoryMediaType
  file_name: string
  mime_type: string
  size_bytes: number
  stored_relative_path: string
  storage_status: StoryMediaStorageStatus
  legacy_source_key: string | null
  created_at: number
}

function requirePositiveId(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(message)
  return value
}

function mapRow(row: StoryMediaRow): StoryMediaInternal {
  return {
    id: Number(row.id),
    localUserId: Number(row.local_user_id),
    fieldKey: row.field_key,
    mediaType: row.media_type,
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    storedRelativePath: String(row.stored_relative_path),
    storageStatus: row.storage_status,
    legacySourceKey: row.legacy_source_key === null ? null : String(row.legacy_source_key),
    createdAt: Number(row.created_at),
  }
}

export class StoryMediaRepository {
  constructor(private readonly db: DatabaseSync) {}

  async insertActive(input: InsertActiveStoryMediaInput): Promise<StoryMediaInternal> {
    const localUserId = requirePositiveId(input.localUserId, 'Invalid local user id')
    const createdAt = Date.now()
    const result = this.db.prepare(`
      INSERT INTO story_media_items (
        local_user_id, field_key, media_type, file_name, mime_type,
        size_bytes, stored_relative_path, storage_status, legacy_source_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?)
    `).run(
      localUserId,
      input.fieldKey,
      input.mediaType,
      input.fileName,
      input.mimeType,
      input.sizeBytes,
      input.storedRelativePath,
      createdAt,
    )
    const row = this.db.prepare(`
      SELECT id, local_user_id, field_key, media_type, file_name, mime_type,
             size_bytes, stored_relative_path, storage_status, legacy_source_key, created_at
        FROM story_media_items
       WHERE id = ? AND local_user_id = ?
    `).get(Number(result.lastInsertRowid), localUserId) as StoryMediaRow | undefined
    if (!row) throw new Error('Story media could not be created')
    return mapRow(row)
  }

  async listByUser(localUserId: number): Promise<StoryMediaInternal[]> {
    const userId = requirePositiveId(localUserId, 'Invalid local user id')
    const rows = this.db.prepare(`
      SELECT id, local_user_id, field_key, media_type, file_name, mime_type,
             size_bytes, stored_relative_path, storage_status, legacy_source_key, created_at
        FROM story_media_items
       WHERE local_user_id = ? AND storage_status = 'active'
       ORDER BY created_at DESC, id DESC
    `).all(userId) as unknown as StoryMediaRow[]
    return rows.map(mapRow)
  }

  async getByIdForUser(localUserId: number, mediaId: number): Promise<StoryMediaInternal | null> {
    const userId = requirePositiveId(localUserId, 'Invalid local user id')
    const id = requirePositiveId(mediaId, 'Story media not found')
    const row = this.db.prepare(`
      SELECT id, local_user_id, field_key, media_type, file_name, mime_type,
             size_bytes, stored_relative_path, storage_status, legacy_source_key, created_at
        FROM story_media_items
       WHERE id = ? AND local_user_id = ? AND storage_status = 'active'
    `).get(id, userId) as StoryMediaRow | undefined
    return row ? mapRow(row) : null
  }

  async deleteByIdForUser(localUserId: number, mediaId: number): Promise<boolean> {
    const userId = requirePositiveId(localUserId, 'Invalid local user id')
    const id = requirePositiveId(mediaId, 'Story media not found')
    const result = this.db.prepare(`
      DELETE FROM story_media_items
       WHERE id = ? AND local_user_id = ? AND storage_status = 'active'
    `).run(id, userId)
    return Number(result.changes) === 1
  }
}
