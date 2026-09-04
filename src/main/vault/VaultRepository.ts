import type { DatabaseSync } from 'node:sqlite'
import type {
  InsertStoredDocumentInput,
  VaultDocumentInternal,
  VaultExtractionSuccess,
  VaultExtractionStatus,
  VaultIndexStatus,
  VaultDeleteStatus,
  VaultFileType,
} from './vaultModels'

interface VaultDocumentRow {
  id: number
  local_user_id: number
  file_name: string
  file_type: VaultFileType
  mime_type: string
  size_bytes: number
  sha256: string
  stored_relative_path: string
  extraction_status: VaultExtractionStatus
  index_status: VaultIndexStatus
  word_count: number
  preview: string | null
  extracted_text: string | null
  last_error_code: string | null
  delete_status: VaultDeleteStatus
  uploaded_at: number
  updated_at: number
}

const SELECT_COLUMNS = `
  id, local_user_id, file_name, file_type, mime_type, size_bytes, sha256,
  stored_relative_path, extraction_status, index_status, word_count, preview,
  extracted_text, last_error_code, delete_status, uploaded_at, updated_at
`

function shapeDocument(row: VaultDocumentRow | undefined): VaultDocumentInternal | null {
  if (!row) return null
  return {
    id: Number(row.id),
    localUserId: Number(row.local_user_id),
    fileName: String(row.file_name),
    fileType: row.file_type,
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    storedRelativePath: String(row.stored_relative_path),
    extractionStatus: row.extraction_status,
    indexStatus: row.index_status,
    wordCount: Number(row.word_count || 0),
    preview: row.preview ?? null,
    extractedText: row.extracted_text ?? null,
    lastErrorCode: row.last_error_code ?? null,
    deleteStatus: row.delete_status,
    uploadedAt: Number(row.uploaded_at),
    updatedAt: Number(row.updated_at),
  }
}

function requireSingleChange(changes: number | bigint, message = 'Vault document not found'): void {
  if (Number(changes) !== 1) throw new Error(message)
}

export class VaultRepository {
  constructor(private readonly db: DatabaseSync) {}

  async findByHash(localUserId: number, sha256: string): Promise<VaultDocumentInternal | null> {
    const row = this.db.prepare(`
      SELECT ${SELECT_COLUMNS}
        FROM vault_documents
       WHERE local_user_id = ? AND sha256 = ?
    `).get(localUserId, sha256) as VaultDocumentRow | undefined
    return shapeDocument(row)
  }

  async insertStoredDocument(input: InsertStoredDocumentInput): Promise<VaultDocumentInternal> {
    const now = Date.now()
    const result = this.db.prepare(`
      INSERT INTO vault_documents (
        local_user_id, file_name, file_type, mime_type, size_bytes, sha256,
        stored_relative_path, extraction_status, index_status, word_count,
        delete_status, uploaded_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)
    `).run(
      input.localUserId,
      input.fileName,
      input.fileType,
      input.mimeType,
      input.sizeBytes,
      input.sha256,
      input.storedRelativePath,
      input.extractionStatus ?? 'pending',
      input.indexStatus ?? 'not_indexed',
      now,
      now,
    )

    const document = await this.getByIdForUser(input.localUserId, Number(result.lastInsertRowid))
    if (!document) throw new Error('Failed to read stored Vault document')
    return document
  }

  async getByIdForUser(localUserId: number, documentId: number): Promise<VaultDocumentInternal | null> {
    const row = this.db.prepare(`
      SELECT ${SELECT_COLUMNS}
        FROM vault_documents
       WHERE id = ? AND local_user_id = ?
    `).get(documentId, localUserId) as VaultDocumentRow | undefined
    return shapeDocument(row)
  }

  async listByUser(localUserId: number): Promise<VaultDocumentInternal[]> {
    const rows = this.db.prepare(`
      SELECT ${SELECT_COLUMNS}
        FROM vault_documents
       WHERE local_user_id = ? AND delete_status = 'active'
       ORDER BY uploaded_at DESC, id DESC
    `).all(localUserId) as unknown as VaultDocumentRow[]
    return rows.map((row) => shapeDocument(row) as VaultDocumentInternal)
  }

  async listPendingDeletions(localUserId: number): Promise<VaultDocumentInternal[]> {
    const rows = this.db.prepare(`
      SELECT ${SELECT_COLUMNS}
        FROM vault_documents
       WHERE local_user_id = ? AND delete_status = 'pending'
       ORDER BY uploaded_at ASC, id ASC
    `).all(localUserId) as unknown as VaultDocumentRow[]
    return rows.map((row) => shapeDocument(row) as VaultDocumentInternal)
  }

  async markExtractionStarted(localUserId: number, documentId: number): Promise<void> {
    const result = this.db.prepare(`
      UPDATE vault_documents
         SET extraction_status = 'extracting', index_status = 'not_indexed',
             last_error_code = NULL, updated_at = ?
       WHERE id = ? AND local_user_id = ? AND delete_status = 'active'
    `).run(Date.now(), documentId, localUserId)
    requireSingleChange(result.changes)
  }

  async markExtractionSuccess(
    localUserId: number,
    documentId: number,
    update: VaultExtractionSuccess,
  ): Promise<void> {
    const result = this.db.prepare(`
      UPDATE vault_documents
         SET extraction_status = 'ready', index_status = 'waiting_for_ai',
             extracted_text = ?, word_count = ?, preview = ?, last_error_code = NULL,
             updated_at = ?
       WHERE id = ? AND local_user_id = ? AND delete_status = 'active'
    `).run(
      update.extractedText,
      update.wordCount,
      update.preview,
      Date.now(),
      documentId,
      localUserId,
    )
    requireSingleChange(result.changes)
  }

  async markExtractionFailure(localUserId: number, documentId: number, errorCode: string): Promise<void> {
    const result = this.db.prepare(`
      UPDATE vault_documents
         SET extraction_status = 'failed', index_status = 'not_indexed',
             last_error_code = ?, updated_at = ?
       WHERE id = ? AND local_user_id = ? AND delete_status = 'active'
    `).run(errorCode, Date.now(), documentId, localUserId)
    requireSingleChange(result.changes)
  }

  async markDeletePending(localUserId: number, documentId: number): Promise<void> {
    const result = this.db.prepare(`
      UPDATE vault_documents
         SET delete_status = 'pending', updated_at = ?
       WHERE id = ? AND local_user_id = ? AND delete_status = 'active'
    `).run(Date.now(), documentId, localUserId)
    requireSingleChange(result.changes)
  }

  async markDeleteActive(localUserId: number, documentId: number, errorCode: string | null = null): Promise<void> {
    const result = this.db.prepare(`
      UPDATE vault_documents
         SET delete_status = 'active', last_error_code = ?, updated_at = ?
       WHERE id = ? AND local_user_id = ? AND delete_status = 'pending'
    `).run(errorCode, Date.now(), documentId, localUserId)
    requireSingleChange(result.changes)
  }

  async deleteByIdForUser(localUserId: number, documentId: number): Promise<boolean> {
    const result = this.db.prepare(
      'DELETE FROM vault_documents WHERE id = ? AND local_user_id = ?',
    ).run(documentId, localUserId)
    return Number(result.changes) === 1
  }
}
