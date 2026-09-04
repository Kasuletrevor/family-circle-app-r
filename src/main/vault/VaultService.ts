import { basename, extname } from 'node:path'
import type { AuthUser } from '../../shared/desktopApi'
import { sha256File, validateSelectedDocument } from './VaultFileStore'
import type { ValidatedSelectedDocument } from './VaultFileStore'
import type {
  InsertStoredDocumentInput,
  VaultDocumentInternal,
  VaultExtractionSuccess,
  VaultFileType,
} from './vaultModels'

export type VaultUploadOutcome =
  | 'uploaded'
  | 'already-exists'
  | 'unsupported'
  | 'too-large'
  | 'extraction-failed'
  | 'failed'

export type VaultUploadStage = 'validating' | 'saving' | 'extracting' | 'done'

export interface VaultUploadProgress {
  fileIndex: number
  fileCount: number
  fileName: string
  stage: VaultUploadStage
  percent: number
}

export interface VaultUploadItemResult {
  fileName: string
  outcome: VaultUploadOutcome
  documentId?: number
}

export interface VaultUploadBatchResult {
  canceled: boolean
  items: VaultUploadItemResult[]
}

export interface VaultSessionSource {
  restore(): Promise<AuthUser | null>
}

export interface VaultFilePicker {
  chooseDocuments(): Promise<string[]>
}

export interface VaultOpenPort {
  openPath(absolutePath: string): Promise<string>
}

export interface VaultRepositoryPort {
  findByHash(localUserId: number, sha256: string): Promise<VaultDocumentInternal | null>
  insertStoredDocument(input: InsertStoredDocumentInput): Promise<VaultDocumentInternal>
  getByIdForUser(localUserId: number, documentId: number): Promise<VaultDocumentInternal | null>
  listByUser(localUserId: number): Promise<VaultDocumentInternal[]>
  listPendingDeletions(localUserId: number): Promise<VaultDocumentInternal[]>
  markExtractionStarted(localUserId: number, documentId: number): Promise<void>
  markExtractionSuccess(localUserId: number, documentId: number, update: VaultExtractionSuccess): Promise<void>
  markExtractionFailure(localUserId: number, documentId: number, errorCode: string): Promise<void>
  markDeletePending(localUserId: number, documentId: number): Promise<void>
  markDeleteActive(localUserId: number, documentId: number, errorCode?: string | null): Promise<void>
  deleteByIdForUser(localUserId: number, documentId: number): Promise<boolean>
}

export interface VaultFileStorePort {
  copyIntoVault(localUserId: number, sourcePath: string, extension: string): Promise<string>
  resolveOwnedPath(localUserId: number, storedRelativePath: string): string
  deleteOwnedFile(localUserId: number, storedRelativePath: string): Promise<void>
}

export interface VaultDocumentExtractorPort {
  extract(filePath: string, fileType: VaultFileType): Promise<VaultExtractionSuccess>
}

interface VaultServiceDependencies {
  session: VaultSessionSource
  picker: VaultFilePicker
  repository: VaultRepositoryPort
  fileStore: VaultFileStorePort
  extractor: VaultDocumentExtractorPort
  opener: VaultOpenPort
  validateDocument?: (sourcePath: string) => Promise<ValidatedSelectedDocument>
  hashFile?: (sourcePath: string) => Promise<string>
}

type VaultServiceErrorCode =
  | 'authentication-required'
  | 'not-found'
  | 'open-failed'
  | 'extraction-failed'
  | 'delete-failed'

export class VaultServiceError extends Error {
  constructor(public readonly code: VaultServiceErrorCode, message: string) {
    super(message)
    this.name = 'VaultServiceError'
  }
}

function normalizedName(value: string): string {
  return value.toLowerCase()
}

export function uniqueDisplayName(originalName: string, existingNames: ReadonlySet<string>): string {
  const existing = new Set([...existingNames].map(normalizedName))
  if (!existing.has(normalizedName(originalName))) return originalName

  const extension = extname(originalName)
  const stem = extension ? originalName.slice(0, -extension.length) : originalName
  const numbered = /^(.*) \((\d+)\)$/.exec(stem)
  const rootStem = numbered ? numbered[1]! : stem
  let suffix = numbered ? Math.max(2, Number(numbered[2]) + 1) : 2

  while (true) {
    const candidate = `${rootStem} (${suffix})${extension}`
    if (!existing.has(normalizedName(candidate))) return candidate
    suffix += 1
  }
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function requireDocumentId(documentId: number): number {
  if (!Number.isSafeInteger(documentId) || documentId <= 0) {
    throw new VaultServiceError('not-found', 'Vault document not found')
  }
  return documentId
}

export class VaultService {
  private readonly validateDocument: (sourcePath: string) => Promise<ValidatedSelectedDocument>
  private readonly hashFile: (sourcePath: string) => Promise<string>

  constructor(private readonly dependencies: VaultServiceDependencies) {
    this.validateDocument = dependencies.validateDocument ?? validateSelectedDocument
    this.hashFile = dependencies.hashFile ?? sha256File
  }

  async listDocuments(): Promise<VaultDocumentInternal[]> {
    const user = await this.requireUser()
    await this.repairPendingDeletions(user.id)
    return this.dependencies.repository.listByUser(user.id)
  }

  async chooseAndUploadDocuments(
    onProgress?: (event: VaultUploadProgress) => void,
  ): Promise<VaultUploadBatchResult> {
    const user = await this.requireUser()
    const sourcePaths = await this.dependencies.picker.chooseDocuments()
    if (sourcePaths.length === 0) return { canceled: true, items: [] }

    const items: VaultUploadItemResult[] = []
    for (let index = 0; index < sourcePaths.length; index += 1) {
      const sourcePath = sourcePaths[index]!
      const originalName = basename(sourcePath)
      const progress = (stage: VaultUploadStage, percent: number) => {
        onProgress?.({
          fileIndex: index + 1,
          fileCount: sourcePaths.length,
          fileName: originalName,
          stage,
          percent,
        })
      }

      progress('validating', 10)
      try {
        const validated = await this.validateDocument(sourcePath)
        const sha256 = await this.hashFile(sourcePath)
        const duplicate = await this.dependencies.repository.findByHash(user.id, sha256)
        if (duplicate) {
          items.push({ fileName: originalName, outcome: 'already-exists', documentId: duplicate.id })
          progress('done', 100)
          continue
        }

        const existingRows = await this.dependencies.repository.listByUser(user.id)
        const displayName = uniqueDisplayName(
          originalName,
          new Set(existingRows.map((row) => row.fileName)),
        )

        progress('saving', 40)
        const storedRelativePath = await this.dependencies.fileStore.copyIntoVault(
          user.id,
          sourcePath,
          validated.extension,
        )

        let storedDocument: VaultDocumentInternal
        try {
          storedDocument = await this.dependencies.repository.insertStoredDocument({
            localUserId: user.id,
            fileName: displayName,
            fileType: validated.fileType,
            mimeType: validated.mimeType,
            sizeBytes: validated.sizeBytes,
            sha256,
            storedRelativePath,
            extractionStatus: 'extracting',
            indexStatus: 'not_indexed',
          })
        } catch {
          try {
            await this.dependencies.fileStore.deleteOwnedFile(user.id, storedRelativePath)
          } catch {
            // No DB row exists to retain cleanup metadata. Keep the stable upload failure.
          }
          items.push({ fileName: displayName, outcome: 'failed' })
          progress('done', 100)
          continue
        }

        progress('extracting', 70)
        try {
          const absolutePath = this.dependencies.fileStore.resolveOwnedPath(user.id, storedRelativePath)
          const extracted = await this.dependencies.extractor.extract(absolutePath, validated.fileType)
          await this.dependencies.repository.markExtractionSuccess(user.id, storedDocument.id, extracted)
          items.push({ fileName: displayName, outcome: 'uploaded', documentId: storedDocument.id })
        } catch (error) {
          const code = errorCode(error)
          const outcome: VaultUploadOutcome = code === 'extraction-failed' ? 'extraction-failed' : 'failed'
          await this.dependencies.repository.markExtractionFailure(
            user.id,
            storedDocument.id,
            code === 'extraction-failed' ? 'extraction-failed' : 'extraction-failed',
          )
          items.push({ fileName: displayName, outcome, documentId: storedDocument.id })
        }
        progress('done', 100)
      } catch (error) {
        const code = errorCode(error)
        const outcome: VaultUploadOutcome = code === 'unsupported'
          ? 'unsupported'
          : code === 'too-large'
            ? 'too-large'
            : 'failed'
        items.push({ fileName: originalName, outcome })
        progress('done', 100)
      }
    }

    return { canceled: false, items }
  }

  async openDocument(documentId: number): Promise<{ success: true }> {
    const user = await this.requireUser()
    const row = await this.requireOwnedActiveDocument(user.id, requireDocumentId(documentId))
    const absolutePath = this.dependencies.fileStore.resolveOwnedPath(user.id, row.storedRelativePath)
    const openError = await this.dependencies.opener.openPath(absolutePath)
    if (openError) throw new VaultServiceError('open-failed', 'Vault document could not be opened')
    return { success: true }
  }

  async retryExtraction(documentId: number): Promise<VaultDocumentInternal> {
    const user = await this.requireUser()
    const id = requireDocumentId(documentId)
    const row = await this.requireOwnedActiveDocument(user.id, id)
    await this.dependencies.repository.markExtractionStarted(user.id, id)

    try {
      const absolutePath = this.dependencies.fileStore.resolveOwnedPath(user.id, row.storedRelativePath)
      const extracted = await this.dependencies.extractor.extract(absolutePath, row.fileType)
      await this.dependencies.repository.markExtractionSuccess(user.id, id, extracted)
    } catch {
      await this.dependencies.repository.markExtractionFailure(user.id, id, 'extraction-failed')
      throw new VaultServiceError('extraction-failed', 'Document text extraction failed')
    }

    const updated = await this.dependencies.repository.getByIdForUser(user.id, id)
    if (!updated || updated.deleteStatus !== 'active') {
      throw new VaultServiceError('not-found', 'Vault document not found')
    }
    return updated
  }

  async deleteDocument(documentId: number): Promise<{ success: true }> {
    const user = await this.requireUser()
    const id = requireDocumentId(documentId)
    const row = await this.requireOwnedActiveDocument(user.id, id)
    await this.dependencies.repository.markDeletePending(user.id, id)

    try {
      await this.dependencies.fileStore.deleteOwnedFile(user.id, row.storedRelativePath)
    } catch {
      await this.dependencies.repository.markDeleteActive(user.id, id, 'delete-failed')
      throw new VaultServiceError('delete-failed', 'Vault document could not be deleted')
    }

    try {
      const deleted = await this.dependencies.repository.deleteByIdForUser(user.id, id)
      if (!deleted) throw new Error('Vault document row disappeared during deletion')
    } catch {
      // Keep the pending row as a tombstone. A later list repairs the DB side.
      throw new VaultServiceError('delete-failed', 'Vault document cleanup is pending')
    }

    return { success: true }
  }

  private async requireUser(): Promise<AuthUser> {
    const user = await this.dependencies.session.restore()
    if (!user) throw new VaultServiceError('authentication-required', 'A protected session is required')
    return user
  }

  private async requireOwnedActiveDocument(localUserId: number, documentId: number): Promise<VaultDocumentInternal> {
    const row = await this.dependencies.repository.getByIdForUser(localUserId, documentId)
    if (!row || row.deleteStatus !== 'active') {
      throw new VaultServiceError('not-found', 'Vault document not found')
    }
    return row
  }

  private async repairPendingDeletions(localUserId: number): Promise<void> {
    const pendingRows = await this.dependencies.repository.listPendingDeletions(localUserId)
    for (const row of pendingRows) {
      try {
        await this.dependencies.fileStore.deleteOwnedFile(localUserId, row.storedRelativePath)
      } catch {
        try {
          await this.dependencies.repository.markDeleteActive(localUserId, row.id, 'delete-failed')
        } catch {
          // Leave the row retryable if even state restoration fails.
        }
        continue
      }

      try {
        await this.dependencies.repository.deleteByIdForUser(localUserId, row.id)
      } catch {
        // Source removal already succeeded. Keep pending tombstone for a future repair pass.
      }
    }
  }
}
