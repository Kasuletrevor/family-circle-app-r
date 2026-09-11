import type { DatabaseSync } from 'node:sqlite'
import type { StoryFieldKey } from '../../shared/story'
import { blobToFloat32, float32ToBlob } from '../vault/vectorCodec'

export interface StoryIndexChunkInput {
  chunkIndex: number
  text: string
  embedding: Float32Array
}

export interface StoryQueryChunk {
  answerId: number
  fieldKey: StoryFieldKey
  chapter: string
  label: string
  text: string
  embedding: Float32Array
  embeddingModel: string
  indexVersion: number
}

interface StoryQueryChunkRow {
  story_answer_id: number
  field_key: StoryFieldKey
  section: string
  label: string
  text: string
  embedding_blob: Uint8Array
  embedding_model: string
  index_version: number
}

function requirePositiveId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Story answer not found')
  return value
}

function requireChunk(chunk: StoryIndexChunkInput): void {
  if (!Number.isSafeInteger(chunk.chunkIndex) || chunk.chunkIndex < 0) throw new Error('Invalid Story chunk index')
  if (!chunk.text.trim()) throw new Error('Story chunk text is required')
  if (chunk.embedding.length === 0) throw new Error('Story chunk embedding is required')
}

export class StoryChunkRepository {
  constructor(private readonly db: DatabaseSync) {}

  async replaceAnswerIndex(
    localUserId: number,
    answerId: number,
    chunks: StoryIndexChunkInput[],
    embeddingModel: string,
    indexVersion: number,
  ): Promise<void> {
    const id = requirePositiveId(answerId)
    if (!embeddingModel.trim()) throw new Error('Embedding model is required')
    if (!Number.isSafeInteger(indexVersion) || indexVersion <= 0) throw new Error('Invalid index version')
    for (const chunk of chunks) requireChunk(chunk)

    this.db.exec('BEGIN IMMEDIATE')
    try {
      const owned = this.db.prepare(`
        SELECT id, confirmed
          FROM story_answers
         WHERE id = ? AND local_user_id = ?
      `).get(id, localUserId) as { id: number; confirmed: number } | undefined
      if (!owned) throw new Error('Story answer not found')
      if (!Boolean(owned.confirmed)) throw new Error('Story answer must be confirmed before indexing')

      this.db.prepare('DELETE FROM story_chunks WHERE story_answer_id = ?').run(id)
      const insert = this.db.prepare(`
        INSERT INTO story_chunks (
          story_answer_id, chunk_index, text, embedding_blob, embedding_model,
          index_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const now = Date.now()
      for (const chunk of chunks) {
        insert.run(
          id,
          chunk.chunkIndex,
          chunk.text,
          float32ToBlob(chunk.embedding),
          embeddingModel,
          indexVersion,
          now,
          now,
        )
      }

      const updated = this.db.prepare(`
        UPDATE story_answers
           SET index_status = 'ready', updated_at = ?
         WHERE id = ? AND local_user_id = ? AND confirmed = 1
      `).run(now, id, localUserId)
      if (Number(updated.changes) !== 1) throw new Error('Story answer not found')

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async deleteForAnswer(localUserId: number, answerId: number): Promise<void> {
    const id = requirePositiveId(answerId)
    const owned = this.db.prepare('SELECT id FROM story_answers WHERE id = ? AND local_user_id = ?').get(id, localUserId)
    if (!owned) throw new Error('Story answer not found')
    this.db.prepare('DELETE FROM story_chunks WHERE story_answer_id = ?').run(id)
  }

  async listQueryChunks(localUserId: number): Promise<StoryQueryChunk[]> {
    const rows = this.db.prepare(`
      SELECT c.story_answer_id, a.field_key, a.section, a.label, c.text,
             c.embedding_blob, c.embedding_model, c.index_version
        FROM story_chunks c
        JOIN story_answers a ON a.id = c.story_answer_id
       WHERE a.local_user_id = ?
         AND a.confirmed = 1
         AND a.index_status = 'ready'
       ORDER BY a.id ASC, c.chunk_index ASC
    `).all(localUserId) as unknown as StoryQueryChunkRow[]

    return rows.map((row) => ({
      answerId: Number(row.story_answer_id),
      fieldKey: row.field_key,
      chapter: String(row.section),
      label: String(row.label),
      text: String(row.text),
      embedding: blobToFloat32(row.embedding_blob),
      embeddingModel: String(row.embedding_model),
      indexVersion: Number(row.index_version),
    }))
  }
}
