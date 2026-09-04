import type { DatabaseSync } from 'node:sqlite'
import { blobToFloat32, float32ToBlob } from './vectorCodec'

export interface VaultIndexChunkInput {
  chunkIndex: number
  text: string
  embedding: Float32Array
}

export interface VaultQueryChunk {
  documentId: number
  fileName: string
  chunkIndex: number
  text: string
  embedding: Float32Array
  embeddingModel: string
  indexVersion: number
}

interface VaultChunkRow {
  document_id: number
  file_name: string
  chunk_index: number
  text: string
  embedding_blob: Uint8Array
  embedding_model: string
  index_version: number
}

function requireDocumentId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid Vault document id')
  return value
}

function requireChunk(chunk: VaultIndexChunkInput): void {
  if (!Number.isSafeInteger(chunk.chunkIndex) || chunk.chunkIndex < 0) throw new Error('Invalid Vault chunk index')
  if (!chunk.text.trim()) throw new Error('Vault chunk text is required')
  if (chunk.embedding.length === 0) throw new Error('Vault chunk embedding is required')
}

export class VaultChunkRepository {
  constructor(private readonly db: DatabaseSync) {}

  async replaceDocumentIndex(
    localUserId: number,
    documentId: number,
    chunks: VaultIndexChunkInput[],
    embeddingModel: string,
    indexVersion: number,
  ): Promise<void> {
    const id = requireDocumentId(documentId)
    if (!Number.isSafeInteger(localUserId) || localUserId <= 0) throw new Error('Invalid local user id')
    if (!embeddingModel.trim()) throw new Error('Embedding model is required')
    if (!Number.isSafeInteger(indexVersion) || indexVersion <= 0) throw new Error('Invalid index version')
    for (const chunk of chunks) requireChunk(chunk)

    this.db.exec('BEGIN IMMEDIATE')
    try {
      const owned = this.db.prepare(`
        SELECT id
          FROM vault_documents
         WHERE id = ? AND local_user_id = ? AND delete_status = 'active'
      `).get(id, localUserId)
      if (!owned) throw new Error('Vault document not found')

      this.db.prepare('DELETE FROM vault_chunks WHERE document_id = ?').run(id)
      const insert = this.db.prepare(`
        INSERT INTO vault_chunks (
          document_id, chunk_index, text, embedding_blob, embedding_model,
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
        UPDATE vault_documents
           SET index_status = 'indexed', last_error_code = NULL, updated_at = ?
         WHERE id = ? AND local_user_id = ? AND delete_status = 'active'
      `).run(now, id, localUserId)
      if (Number(updated.changes) !== 1) throw new Error('Vault document not found')

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async listQueryChunks(localUserId: number, documentIds?: number[]): Promise<VaultQueryChunk[]> {
    if (!Number.isSafeInteger(localUserId) || localUserId <= 0) throw new Error('Invalid local user id')
    if (documentIds?.length === 0) return []

    const selectedIds = documentIds?.map(requireDocumentId)
    const selectionSql = selectedIds
      ? ` AND d.id IN (${selectedIds.map(() => '?').join(', ')})`
      : ''
    const params: Array<number> = [localUserId, ...(selectedIds ?? [])]
    const rows = this.db.prepare(`
      SELECT c.document_id, d.file_name, c.chunk_index, c.text,
             c.embedding_blob, c.embedding_model, c.index_version
        FROM vault_chunks c
        JOIN vault_documents d ON d.id = c.document_id
       WHERE d.local_user_id = ?
         AND d.delete_status = 'active'
         AND d.index_status = 'indexed'
         ${selectionSql}
       ORDER BY d.id ASC, c.chunk_index ASC
    `).all(...params) as unknown as VaultChunkRow[]

    return rows.map((row) => ({
      documentId: Number(row.document_id),
      fileName: String(row.file_name),
      chunkIndex: Number(row.chunk_index),
      text: String(row.text),
      embedding: blobToFloat32(row.embedding_blob),
      embeddingModel: String(row.embedding_model),
      indexVersion: Number(row.index_version),
    }))
  }
}
