import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  STORY_FIELDS,
  STORY_FIELD_KEYS,
  STORY_SCHEMA_VERSION,
  normalizeStoryLanguage,
  type StoryFieldKey,
  type StoryLanguage,
} from '../../shared/story'
import {
  storySemanticSignature,
  type StorySemanticSnapshot,
} from './storyModels'
import {
  StoryMediaStore,
  StoryMediaStoreError,
  type StoryMediaType,
  type ValidatedStoryMedia,
} from './StoryMediaStore'

const MIGRATION_KEY = 'legacy-my-story-v1'

export type StoryImportDiagnosticReason =
  | 'damaged-story'
  | 'damaged-history'
  | 'invalid-field'
  | 'invalid-media-type'
  | 'outside-legacy-root'
  | 'missing-file'
  | 'unsupported-media'
  | 'too-large'

export interface StoryImportDiagnostic {
  userId: number
  sourceId?: number
  reason: StoryImportDiagnosticReason
}

export interface StoryImportReport {
  importedUsers: number
  skippedUsers: number
  diagnostics: StoryImportDiagnostic[]
}

interface StoryLegacyImporterDependencies {
  db: DatabaseSync
  appDataPath: string
  userDataPath: string
  mediaStore: StoryMediaStore
  afterMediaReservation?: () => void | Promise<void>
}

interface LegacyStoryRow {
  story_json: string
  updated_at: number
}

interface LegacyEntryRow {
  field_key: string
  answer: string
  language: string
  updated_at: number
}

interface LegacyHistoryRow {
  id: number
  story_json: string
  created_at: number
}

interface LegacyMediaRow {
  id: number
  user_id: number
  field_key: string
  media_type: string
  file_name: string
  file_path: string
  created_at: number
}

interface ReservedMediaRow {
  id: number
  stored_relative_path: string
  storage_status: string
}

type LegacyStory = Record<string, unknown>

function tableExists(db: DatabaseSync, tableName: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`).get(tableName))
}

function objectValue(value: unknown): LegacyStory | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as LegacyStory
    : null
}

function parseStory(value: unknown): LegacyStory | null {
  if (typeof value !== 'string') return null
  try {
    return objectValue(JSON.parse(value))
  } catch {
    return null
  }
}

function stringValue(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function languageOrEnglish(value: unknown): StoryLanguage {
  const raw = stringValue(value)
  if (!raw) return 'en'
  try {
    return normalizeStoryLanguage(raw).code
  } catch {
    return 'en'
  }
}

function firstLanguageCandidate(...values: unknown[]): StoryLanguage {
  for (const value of values) {
    if (stringValue(value)) return languageOrEnglish(value)
  }
  return 'en'
}

function fieldSetHas(value: string): value is StoryFieldKey {
  return (STORY_FIELD_KEYS as readonly string[]).includes(value)
}

function explicitConfirmations(story: LegacyStory | null): LegacyStory | null {
  return story ? objectValue(story.__confirmed) : null
}

function languageMap(story: LegacyStory | null): LegacyStory | null {
  return story ? objectValue(story.__languages) : null
}

function semanticSnapshotFromLegacy(story: LegacyStory, createdAt: number): StorySemanticSnapshot {
  const confirmations = explicitConfirmations(story)
  const languages = languageMap(story)
  const defaultLanguage = story.__language
  const answers = Object.fromEntries(STORY_FIELDS.map((field) => {
    const answer = stringValue(story[field.key])
    const confirmed = Boolean(answer) && (confirmations ? confirmations[field.key] === true : true)
    return [field.key, {
      answer,
      language: firstLanguageCandidate(languages?.[field.key], defaultLanguage),
      confirmed,
      confirmedAt: confirmed ? createdAt : null,
    }]
  })) as StorySemanticSnapshot['answers']

  return { schemaVersion: STORY_SCHEMA_VERSION, answers }
}

function sourceKey(row: LegacyMediaRow, sourcePath: string): string {
  const normalized = process.platform === 'win32' ? sourcePath.toLowerCase() : sourcePath
  return createHash('sha256').update(JSON.stringify([
    row.id,
    row.user_id,
    row.field_key,
    row.media_type,
    row.file_name,
    normalized,
  ]), 'utf8').digest('hex')
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  const left = process.platform === 'win32' ? normalizedRoot.toLowerCase() : normalizedRoot
  const right = process.platform === 'win32' ? normalizedCandidate.toLowerCase() : normalizedCandidate
  const prefix = left.endsWith(sep) ? left : `${left}${sep}`
  return right === left || right.startsWith(prefix)
}

function runTransaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export class StoryLegacyImporter {
  constructor(private readonly dependencies: StoryLegacyImporterDependencies) {}

  async importForExistingUsers(): Promise<StoryImportReport> {
    const diagnostics: StoryImportDiagnostic[] = []
    const userRows = this.dependencies.db.prepare('SELECT id FROM users ORDER BY id').all() as Array<{ id: number }>
    let importedUsers = 0
    let skippedUsers = 0

    for (const row of userRows) {
      const localUserId = Number(row.id)
      if (this.isComplete(localUserId)) {
        skippedUsers += 1
        continue
      }

      this.importAnswers(localUserId, diagnostics)
      this.importHistory(localUserId, diagnostics)
      await this.importMedia(localUserId, diagnostics)
      this.dependencies.db.prepare(`
        INSERT OR IGNORE INTO story_import_state (local_user_id, migration_key, completed_at)
        VALUES (?, ?, ?)
      `).run(localUserId, MIGRATION_KEY, Date.now())
      importedUsers += 1
    }

    return { importedUsers, skippedUsers, diagnostics }
  }

  private isComplete(localUserId: number): boolean {
    return Boolean(this.dependencies.db.prepare(`
      SELECT 1 FROM story_import_state WHERE local_user_id = ? AND migration_key = ?
    `).get(localUserId, MIGRATION_KEY))
  }

  private importAnswers(localUserId: number, diagnostics: StoryImportDiagnostic[]): void {
    const db = this.dependencies.db
    const hasStories = tableExists(db, 'my_stories')
    const hasEntries = tableExists(db, 'story_entries')
    const storyRow = hasStories
      ? db.prepare('SELECT story_json, updated_at FROM my_stories WHERE user_id = ?').get(localUserId) as LegacyStoryRow | undefined
      : undefined
    const parsedStory = storyRow ? parseStory(storyRow.story_json) : null
    if (storyRow && !parsedStory) diagnostics.push({ userId: localUserId, reason: 'damaged-story' })

    const entryRows = hasEntries
      ? db.prepare('SELECT field_key, answer, language, updated_at FROM story_entries WHERE user_id = ?').all(localUserId) as unknown as LegacyEntryRow[]
      : []
    const entries = new Map(entryRows.map((entry) => [String(entry.field_key), entry]))
    const confirmations = explicitConfirmations(parsedStory)
    const languages = languageMap(parsedStory)

    runTransaction(db, () => {
      for (const field of STORY_FIELDS) {
        const hasJsonValue = Boolean(parsedStory && Object.prototype.hasOwnProperty.call(parsedStory, field.key))
        const entry = entries.get(field.key)
        const answer = hasJsonValue ? stringValue(parsedStory?.[field.key]) : stringValue(entry?.answer)
        if (!answer) continue

        const sourceTimestamp = Number(hasJsonValue ? storyRow?.updated_at : entry?.updated_at) || Date.now()
        const confirmed = confirmations ? confirmations[field.key] === true : true
        const language = firstLanguageCandidate(
          languages?.[field.key],
          entry?.language,
          parsedStory?.__language,
        )
        const indexStatus = confirmed ? 'pending' : 'not_indexed'
        const confirmedAt = confirmed ? sourceTimestamp : null

        const existing = db.prepare(`
          SELECT id FROM story_answers WHERE local_user_id = ? AND field_key = ?
        `).get(localUserId, field.key) as { id: number } | undefined
        if (existing) db.prepare('DELETE FROM story_chunks WHERE story_answer_id = ?').run(existing.id)

        db.prepare(`
          INSERT INTO story_answers (
            local_user_id, field_key, schema_version, section, label, question,
            answer, language, confirmed, index_status, created_at, updated_at, confirmed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(local_user_id, field_key) DO UPDATE SET
            schema_version = excluded.schema_version,
            section = excluded.section,
            label = excluded.label,
            question = excluded.question,
            answer = excluded.answer,
            language = excluded.language,
            confirmed = excluded.confirmed,
            index_status = excluded.index_status,
            updated_at = excluded.updated_at,
            confirmed_at = excluded.confirmed_at
        `).run(
          localUserId,
          field.key,
          STORY_SCHEMA_VERSION,
          field.section,
          field.label,
          field.prompt,
          answer,
          language,
          confirmed ? 1 : 0,
          indexStatus,
          sourceTimestamp,
          sourceTimestamp,
          confirmedAt,
        )
      }
    })
  }

  private importHistory(localUserId: number, diagnostics: StoryImportDiagnostic[]): void {
    const db = this.dependencies.db
    if (!tableExists(db, 'story_history')) return
    const rows = db.prepare(`
      SELECT id, story_json, created_at FROM story_history
       WHERE user_id = ? ORDER BY created_at DESC, id DESC
    `).all(localUserId) as unknown as LegacyHistoryRow[]

    const seen = new Set<string>()
    runTransaction(db, () => {
      const existing = db.prepare('SELECT semantic_signature FROM story_versions WHERE local_user_id = ?')
        .all(localUserId) as Array<{ semantic_signature: string }>
      for (const item of existing) seen.add(String(item.semantic_signature))

      for (const row of rows) {
        const story = parseStory(row.story_json)
        if (!story) {
          diagnostics.push({ userId: localUserId, sourceId: Number(row.id), reason: 'damaged-history' })
          continue
        }
        const snapshot = semanticSnapshotFromLegacy(story, Number(row.created_at))
        const signature = storySemanticSignature(snapshot)
        if (seen.has(signature)) continue
        seen.add(signature)
        db.prepare(`
          INSERT INTO story_versions (local_user_id, snapshot_json, semantic_signature, created_at)
          VALUES (?, ?, ?, ?)
        `).run(localUserId, JSON.stringify(snapshot), signature, Number(row.created_at))
      }

      db.prepare(`
        DELETE FROM story_versions
         WHERE local_user_id = ?
           AND id NOT IN (
             SELECT id FROM story_versions
              WHERE local_user_id = ?
              ORDER BY created_at DESC, id DESC LIMIT 30
           )
      `).run(localUserId, localUserId)
    })
  }

  private async importMedia(localUserId: number, diagnostics: StoryImportDiagnostic[]): Promise<void> {
    const db = this.dependencies.db
    if (!tableExists(db, 'story_media')) return
    const rows = db.prepare(`
      SELECT id, user_id, field_key, media_type, file_name, file_path, created_at
        FROM story_media WHERE user_id = ? ORDER BY id
    `).all(localUserId) as unknown as LegacyMediaRow[]
    const legacyRoot = join(this.dependencies.appDataPath, 'Family Circle')

    for (const row of rows) {
      const fieldKey = String(row.field_key)
      if (!fieldSetHas(fieldKey)) {
        diagnostics.push({ userId: localUserId, sourceId: Number(row.id), reason: 'invalid-field' })
        continue
      }

      const mediaType = String(row.media_type)
      if (mediaType !== 'photo' && mediaType !== 'audio') {
        diagnostics.push({ userId: localUserId, sourceId: Number(row.id), reason: 'invalid-media-type' })
        continue
      }

      const sourcePath = resolve(String(row.file_path))
      if (!isWithin(legacyRoot, sourcePath)) {
        diagnostics.push({ userId: localUserId, sourceId: Number(row.id), reason: 'outside-legacy-root' })
        continue
      }

      let canonicalRoot: string
      let canonicalSource: string
      try {
        canonicalRoot = await realpath(legacyRoot)
        canonicalSource = await realpath(sourcePath)
      } catch {
        diagnostics.push({ userId: localUserId, sourceId: Number(row.id), reason: 'missing-file' })
        continue
      }
      if (!isWithin(canonicalRoot, canonicalSource)) {
        diagnostics.push({ userId: localUserId, sourceId: Number(row.id), reason: 'outside-legacy-root' })
        continue
      }

      let validated: ValidatedStoryMedia
      try {
        validated = await this.dependencies.mediaStore.validateSelected(canonicalSource, mediaType as StoryMediaType)
      } catch (error) {
        const reason: StoryImportDiagnosticReason = error instanceof StoryMediaStoreError && error.code === 'too-large'
          ? 'too-large'
          : 'unsupported-media'
        diagnostics.push({ userId: localUserId, sourceId: Number(row.id), reason })
        continue
      }

      const legacySourceKey = sourceKey(row, canonicalSource)
      let reservation = db.prepare(`
        SELECT id, stored_relative_path, storage_status
          FROM story_media_items
         WHERE local_user_id = ? AND legacy_source_key = ?
      `).get(localUserId, legacySourceKey) as ReservedMediaRow | undefined
      let createdReservation = false

      if (!reservation) {
        const storedRelativePath = await this.dependencies.mediaStore.reserveStoredPath(localUserId, validated.extension)
        reservation = runTransaction(db, () => {
          const existing = db.prepare(`
            SELECT id, stored_relative_path, storage_status
              FROM story_media_items
             WHERE local_user_id = ? AND legacy_source_key = ?
          `).get(localUserId, legacySourceKey) as ReservedMediaRow | undefined
          if (existing) return existing

          const result = db.prepare(`
            INSERT INTO story_media_items (
              local_user_id, field_key, media_type, file_name, mime_type, size_bytes,
              stored_relative_path, storage_status, legacy_source_key, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'copying', ?, ?)
          `).run(
            localUserId,
            fieldKey,
            mediaType,
            String(row.file_name),
            validated.mimeType,
            validated.sizeBytes,
            storedRelativePath,
            legacySourceKey,
            Number(row.created_at) || Date.now(),
          )
          createdReservation = true
          return {
            id: Number(result.lastInsertRowid),
            stored_relative_path: storedRelativePath,
            storage_status: 'copying',
          }
        })
      }

      if (createdReservation) await this.dependencies.afterMediaReservation?.()
      if (reservation.storage_status === 'active') continue

      await this.dependencies.mediaStore.copyIntoReserved(
        localUserId,
        canonicalSource,
        reservation.stored_relative_path,
      )
      db.prepare(`
        UPDATE story_media_items SET storage_status = 'active'
         WHERE id = ? AND local_user_id = ? AND legacy_source_key = ?
      `).run(reservation.id, localUserId, legacySourceKey)
    }
  }
}
