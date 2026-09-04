import { basename, extname } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import type {
  InsertStoredDocumentInput,
  VaultDocumentInternal,
  VaultExtractionSuccess,
  VaultFileType,
} from './vaultModels'
import { VaultService, uniqueDisplayName } from './VaultService'

const USER: AuthUser = {
  id: 7,
  email: 'trevor@example.test',
  name: 'Trevor',
  accountOrigin: 'registered',
  mustChangePassword: false,
  onboardingCompleted: true,
}

function document(overrides: Partial<VaultDocumentInternal> = {}): VaultDocumentInternal {
  return {
    id: 1,
    localUserId: USER.id,
    fileName: 'Family History.txt',
    fileType: 'txt',
    mimeType: 'text/plain',
    sizeBytes: 42,
    sha256: 'hash-1',
    storedRelativePath: 'vault/users/7/documents/stored-1.txt',
    extractionStatus: 'ready',
    indexStatus: 'waiting_for_ai',
    wordCount: 4,
    preview: 'A private family history.',
    extractedText: 'A private family history.',
    lastErrorCode: null,
    deleteStatus: 'active',
    uploadedAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

class FakeRepository {
  documents: VaultDocumentInternal[] = []
  failInsert = false
  failDelete = false
  calls: string[] = []
  private nextId = 100

  async findByHash(localUserId: number, sha256: string) {
    this.calls.push(`findByHash:${localUserId}:${sha256}`)
    return this.documents.find((row) => row.localUserId === localUserId && row.sha256 === sha256) ?? null
  }

  async insertStoredDocument(input: InsertStoredDocumentInput) {
    this.calls.push(`insert:${input.localUserId}:${input.fileName}`)
    if (this.failInsert) throw new Error('db insert failed')
    const now = Date.now()
    const row = document({
      id: this.nextId++,
      localUserId: input.localUserId,
      fileName: input.fileName,
      fileType: input.fileType,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      storedRelativePath: input.storedRelativePath,
      extractionStatus: input.extractionStatus ?? 'pending',
      indexStatus: input.indexStatus ?? 'not_indexed',
      wordCount: 0,
      preview: null,
      extractedText: null,
      lastErrorCode: null,
      deleteStatus: 'active',
      uploadedAt: now,
      updatedAt: now,
    })
    this.documents.push(row)
    return row
  }

  async getByIdForUser(localUserId: number, documentId: number) {
    this.calls.push(`get:${localUserId}:${documentId}`)
    return this.documents.find((row) => row.localUserId === localUserId && row.id === documentId) ?? null
  }

  async listByUser(localUserId: number) {
    this.calls.push(`list:${localUserId}`)
    return this.documents.filter((row) => row.localUserId === localUserId && row.deleteStatus === 'active')
  }

  async listPendingDeletions(localUserId: number) {
    this.calls.push(`pending:${localUserId}`)
    return this.documents.filter((row) => row.localUserId === localUserId && row.deleteStatus === 'pending')
  }

  async markExtractionStarted(localUserId: number, documentId: number) {
    this.calls.push(`extract-start:${localUserId}:${documentId}`)
    const row = await this.requireOwned(localUserId, documentId)
    row.extractionStatus = 'extracting'
    row.indexStatus = 'not_indexed'
    row.lastErrorCode = null
  }

  async markExtractionSuccess(localUserId: number, documentId: number, update: VaultExtractionSuccess) {
    this.calls.push(`extract-success:${localUserId}:${documentId}`)
    const row = await this.requireOwned(localUserId, documentId)
    row.extractionStatus = 'ready'
    row.indexStatus = 'waiting_for_ai'
    row.extractedText = update.extractedText
    row.wordCount = update.wordCount
    row.preview = update.preview
    row.lastErrorCode = null
  }

  async markExtractionFailure(localUserId: number, documentId: number, errorCode: string) {
    this.calls.push(`extract-failure:${localUserId}:${documentId}:${errorCode}`)
    const row = await this.requireOwned(localUserId, documentId)
    row.extractionStatus = 'failed'
    row.indexStatus = 'not_indexed'
    row.lastErrorCode = errorCode
  }

  async markDeletePending(localUserId: number, documentId: number) {
    this.calls.push(`delete-pending:${localUserId}:${documentId}`)
    const row = await this.requireOwned(localUserId, documentId)
    row.deleteStatus = 'pending'
  }

  async markDeleteActive(localUserId: number, documentId: number, errorCode: string | null = null) {
    this.calls.push(`delete-active:${localUserId}:${documentId}:${errorCode ?? ''}`)
    const row = await this.requireOwned(localUserId, documentId)
    row.deleteStatus = 'active'
    row.lastErrorCode = errorCode
  }

  async deleteByIdForUser(localUserId: number, documentId: number) {
    this.calls.push(`delete-row:${localUserId}:${documentId}`)
    if (this.failDelete) throw new Error('db delete failed')
    const index = this.documents.findIndex((row) => row.localUserId === localUserId && row.id === documentId)
    if (index < 0) return false
    this.documents.splice(index, 1)
    return true
  }

  private async requireOwned(localUserId: number, documentId: number) {
    const row = this.documents.find((candidate) => candidate.localUserId === localUserId && candidate.id === documentId)
    if (!row) throw new Error('Vault document not found')
    return row
  }
}

class FakeFileStore {
  copied: Array<{ localUserId: number; sourcePath: string; extension: string; storedRelativePath: string }> = []
  resolved: Array<{ localUserId: number; storedRelativePath: string }> = []
  deleted: Array<{ localUserId: number; storedRelativePath: string }> = []
  deleteFailure: Error | null = null
  private sequence = 1

  async copyIntoVault(localUserId: number, sourcePath: string, extension: string) {
    const storedRelativePath = `vault/users/${localUserId}/documents/stored-${this.sequence++}${extension}`
    this.copied.push({ localUserId, sourcePath, extension, storedRelativePath })
    return storedRelativePath
  }

  resolveOwnedPath(localUserId: number, storedRelativePath: string) {
    this.resolved.push({ localUserId, storedRelativePath })
    if (!storedRelativePath.startsWith(`vault/users/${localUserId}/documents/`)) throw new Error('not owned')
    return `/private/${storedRelativePath}`
  }

  async deleteOwnedFile(localUserId: number, storedRelativePath: string) {
    this.deleted.push({ localUserId, storedRelativePath })
    if (this.deleteFailure) throw this.deleteFailure
  }
}

interface SelectedFileDefinition {
  hash?: string
  fileType?: VaultFileType
  mimeType?: string
  sizeBytes?: number
  validationError?: { code: string }
  extractionError?: Error & { code?: string }
  extractedText?: string
}

function makeHarness(options: {
  user?: AuthUser | null
  selectedPaths?: string[]
  selected?: Record<string, SelectedFileDefinition>
} = {}) {
  const repository = new FakeRepository()
  const fileStore = new FakeFileStore()
  const selected = options.selected ?? {}
  const session = {
    restore: vi.fn(async () => options.user === undefined ? USER : options.user),
  }
  const picker = {
    chooseDocuments: vi.fn(async () => options.selectedPaths ?? []),
  }
  const opener = {
    openPath: vi.fn(async () => ''),
  }
  const extractor = {
    extract: vi.fn(async (absolutePath: string, fileType: VaultFileType) => {
      const sourceName = basename(absolutePath).replace(/^stored-\d+/, 'selected')
      const byStoredIndex = fileStore.copied.find((copy) => absolutePath.endsWith(copy.storedRelativePath))
      const definition = byStoredIndex ? selected[byStoredIndex.sourcePath] : undefined
      if (definition?.extractionError) throw definition.extractionError
      const extractedText = definition?.extractedText ?? `Extracted ${sourceName} ${fileType}`
      return {
        extractedText,
        wordCount: extractedText.trim().split(/\s+/).filter(Boolean).length,
        preview: extractedText.replace(/\s+/g, ' ').trim().slice(0, 240),
      }
    }),
  }
  const validateDocument = vi.fn(async (sourcePath: string) => {
    const definition = selected[sourcePath] ?? {}
    if (definition.validationError) throw definition.validationError
    const extension = extname(sourcePath).toLowerCase() as '.pdf' | '.docx' | '.txt'
    const fileType = definition.fileType ?? extension.slice(1) as VaultFileType
    const mimeType = definition.mimeType
      ?? (fileType === 'pdf'
        ? 'application/pdf'
        : fileType === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'text/plain')
    return {
      fileType,
      mimeType,
      extension,
      sizeBytes: definition.sizeBytes ?? 100,
    }
  })
  const hashFile = vi.fn(async (sourcePath: string) => selected[sourcePath]?.hash ?? `hash:${sourcePath}`)

  const service = new VaultService({
    session,
    picker,
    repository,
    fileStore,
    extractor,
    opener,
    validateDocument,
    hashFile,
  })

  return { service, repository, fileStore, session, picker, opener, extractor, validateDocument, hashFile }
}

describe('VaultService protection and ownership', () => {
  it('requires a protected session for every operation', async () => {
    const { service, repository, picker, opener } = makeHarness({ user: null })

    const operations = [
      () => service.listDocuments(),
      () => service.chooseAndUploadDocuments(),
      () => service.openDocument(1),
      () => service.retryExtraction(1),
      () => service.deleteDocument(1),
    ]

    for (const operation of operations) {
      await expect(operation()).rejects.toMatchObject({ code: 'authentication-required' })
    }
    expect(repository.calls).toEqual([])
    expect(picker.chooseDocuments).not.toHaveBeenCalled()
    expect(opener.openPath).not.toHaveBeenCalled()
  })

  it('never accepts renderer localUserId and always scopes repository work to restored user', async () => {
    const { service, repository } = makeHarness()
    repository.documents.push(document({ id: 9, localUserId: USER.id }))

    await (service.listDocuments as unknown as (localUserId: number) => Promise<unknown>)(999)
    await (service.openDocument as unknown as (documentId: number, localUserId: number) => Promise<unknown>)(9, 999)

    expect(repository.calls).toContain('list:7')
    expect(repository.calls).toContain('get:7:9')
    expect(repository.calls.some((call) => call.includes(':999'))).toBe(false)
  })

  it('lists only the restored user documents', async () => {
    const { service, repository } = makeHarness()
    repository.documents.push(
      document({ id: 1, localUserId: USER.id, fileName: 'Mine.txt' }),
      document({ id: 2, localUserId: 8, fileName: 'Someone Else.txt', storedRelativePath: 'vault/users/8/documents/2.txt' }),
    )

    const rows = await service.listDocuments()
    expect(rows.map((row) => row.fileName)).toEqual(['Mine.txt'])
  })

  it('cannot open, retry or delete another user document by guessed id', async () => {
    const actions = ['open', 'retry', 'delete'] as const
    for (const action of actions) {
      const { service, repository, fileStore, opener, extractor } = makeHarness()
      repository.documents.push(document({
        id: 77,
        localUserId: 8,
        storedRelativePath: 'vault/users/8/documents/private.txt',
      }))

      const operation = action === 'open'
        ? service.openDocument(77)
        : action === 'retry'
          ? service.retryExtraction(77)
          : service.deleteDocument(77)
      await expect(operation).rejects.toMatchObject({ code: 'not-found' })
      expect(fileStore.resolved).toEqual([])
      expect(fileStore.deleted).toEqual([])
      expect(opener.openPath).not.toHaveBeenCalled()
      expect(extractor.extract).not.toHaveBeenCalled()
    }
  })
})

describe('VaultService upload ingestion', () => {
  it('returns canceled when no files are selected', async () => {
    const { service } = makeHarness({ selectedPaths: [] })
    await expect(service.chooseAndUploadDocuments()).resolves.toEqual({ canceled: true, items: [] })
  })

  it('processes multiple files independently', async () => {
    const extractionFailure = Object.assign(new Error('bad parser detail'), { code: 'extraction-failed' })
    const paths = ['/selected/one.txt', '/selected/two.rtf', '/selected/three.pdf']
    const { service, repository } = makeHarness({
      selectedPaths: paths,
      selected: {
        [paths[0]]: { hash: 'one', extractedText: 'one family record' },
        [paths[1]]: { validationError: { code: 'unsupported' } },
        [paths[2]]: { hash: 'three', extractionError: extractionFailure, fileType: 'pdf' },
      },
    })

    const result = await service.chooseAndUploadDocuments()
    expect(result.canceled).toBe(false)
    expect(result.items.map((item) => item.outcome)).toEqual(['uploaded', 'unsupported', 'extraction-failed'])
    expect(repository.documents).toHaveLength(2)
    expect(repository.documents.find((row) => row.sha256 === 'three')?.extractionStatus).toBe('failed')
  })

  it('rejects exact-byte duplicate before copy', async () => {
    const path = '/selected/duplicate.txt'
    const { service, repository, fileStore } = makeHarness({
      selectedPaths: [path],
      selected: { [path]: { hash: 'same-bytes' } },
    })
    repository.documents.push(document({ sha256: 'same-bytes' }))

    const result = await service.chooseAndUploadDocuments()
    expect(result.items[0]?.outcome).toBe('already-exists')
    expect(fileStore.copied).toEqual([])
  })

  it('keeps same-name different bytes as separate documents', async () => {
    const path = '/selected/Family History.pdf'
    const { service, repository } = makeHarness({
      selectedPaths: [path],
      selected: { [path]: { hash: 'different-bytes', fileType: 'pdf' } },
    })
    repository.documents.push(document({
      id: 1,
      fileName: 'Family History.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      sha256: 'old-bytes',
      storedRelativePath: 'vault/users/7/documents/old.pdf',
    }))

    const result = await service.chooseAndUploadDocuments()
    expect(result.items[0]?.outcome).toBe('uploaded')
    expect(repository.documents.map((row) => row.fileName)).toEqual(['Family History.pdf', 'Family History (2).pdf'])
  })

  it('renames display collision Family History.pdf -> Family History (2).pdf', () => {
    expect(uniqueDisplayName('Family History.pdf', new Set(['family history.PDF']))).toBe('Family History (2).pdf')
  })

  it('increments collision Family History (2).pdf -> Family History (3).pdf', () => {
    expect(uniqueDisplayName(
      'Family History (2).pdf',
      new Set(['Family History.pdf', 'Family History (2).PDF']),
    )).toBe('Family History (3).pdf')
  })

  it('cleans copied file if DB insert fails', async () => {
    const path = '/selected/insert-fails.txt'
    const { service, repository, fileStore } = makeHarness({ selectedPaths: [path] })
    repository.failInsert = true

    const result = await service.chooseAndUploadDocuments()
    expect(result.items[0]?.outcome).toBe('failed')
    expect(fileStore.copied).toHaveLength(1)
    expect(fileStore.deleted).toEqual([{
      localUserId: USER.id,
      storedRelativePath: fileStore.copied[0]!.storedRelativePath,
    }])
  })

  it('keeps stored source when extraction fails', async () => {
    const path = '/selected/broken.pdf'
    const extractionFailure = Object.assign(new Error('parser detail'), { code: 'extraction-failed' })
    const { service, repository, fileStore } = makeHarness({
      selectedPaths: [path],
      selected: { [path]: { fileType: 'pdf', extractionError: extractionFailure } },
    })

    const result = await service.chooseAndUploadDocuments()
    expect(result.items[0]?.outcome).toBe('extraction-failed')
    expect(fileStore.deleted).toEqual([])
    expect(repository.documents[0]).toMatchObject({
      extractionStatus: 'failed',
      lastErrorCode: 'extraction-failed',
    })
  })

  it('marks extraction success waiting_for_ai without checking model readiness', async () => {
    const path = '/selected/ready.txt'
    const { service, repository } = makeHarness({
      selectedPaths: [path],
      selected: { [path]: { extractedText: 'family history is ready' } },
    })

    const result = await service.chooseAndUploadDocuments()
    expect(result.items[0]?.outcome).toBe('uploaded')
    expect(repository.documents[0]).toMatchObject({
      extractionStatus: 'ready',
      indexStatus: 'waiting_for_ai',
      extractedText: 'family history is ready',
    })
  })

  it('emits safe validating/saving/extracting/done progress', async () => {
    const sourcePath = '/selected/private-source-name.txt'
    const { service } = makeHarness({ selectedPaths: [sourcePath] })
    const events: unknown[] = []

    await service.chooseAndUploadDocuments((event) => events.push(event))

    expect(events).toMatchObject([
      { fileIndex: 1, fileCount: 1, fileName: 'private-source-name.txt', stage: 'validating' },
      { fileIndex: 1, fileCount: 1, fileName: 'private-source-name.txt', stage: 'saving' },
      { fileIndex: 1, fileCount: 1, fileName: 'private-source-name.txt', stage: 'extracting' },
      { fileIndex: 1, fileCount: 1, fileName: 'private-source-name.txt', stage: 'done', percent: 100 },
    ])
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain(sourcePath)
    expect(serialized).not.toContain('storedRelativePath')
    expect(serialized).not.toContain('/private/')
  })
})

describe('VaultService open, retry and recoverable deletion', () => {
  it('opens only the resolved owned path', async () => {
    const { service, repository, fileStore, opener } = makeHarness()
    const row = document({ id: 12 })
    repository.documents.push(row)

    await expect(service.openDocument(12)).resolves.toEqual({ success: true })
    expect(fileStore.resolved).toEqual([{ localUserId: USER.id, storedRelativePath: row.storedRelativePath }])
    expect(opener.openPath).toHaveBeenCalledWith(`/private/${row.storedRelativePath}`)
  })

  it('maps shell.openPath error string to open-failed', async () => {
    const { service, repository, opener } = makeHarness()
    repository.documents.push(document({ id: 13 }))
    opener.openPath.mockResolvedValueOnce('Windows could not open this file')

    await expect(service.openDocument(13)).rejects.toMatchObject({ code: 'open-failed' })
  })

  it('retry re-extracts stored source', async () => {
    const { service, repository, extractor } = makeHarness()
    repository.documents.push(document({
      id: 14,
      extractionStatus: 'failed',
      indexStatus: 'not_indexed',
      extractedText: null,
      preview: null,
      wordCount: 0,
      lastErrorCode: 'extraction-failed',
    }))

    extractor.extract.mockResolvedValueOnce({
      extractedText: 'Recovered family history',
      wordCount: 3,
      preview: 'Recovered family history',
    })

    const updated = await service.retryExtraction(14)
    expect(updated).toMatchObject({
      extractionStatus: 'ready',
      indexStatus: 'waiting_for_ai',
      extractedText: 'Recovered family history',
      lastErrorCode: null,
    })
    expect(repository.calls).toContain('extract-start:7:14')
    expect(repository.calls).toContain('extract-success:7:14')
  })

  it('marks delete pending before file removal', async () => {
    const { service, repository, fileStore } = makeHarness()
    const row = document({ id: 15 })
    repository.documents.push(row)
    const order: string[] = []
    const originalPending = repository.markDeletePending.bind(repository)
    repository.markDeletePending = async (...args) => { order.push('pending'); await originalPending(...args) }
    const originalFileDelete = fileStore.deleteOwnedFile.bind(fileStore)
    fileStore.deleteOwnedFile = async (...args) => { order.push('file'); await originalFileDelete(...args) }
    const originalRowDelete = repository.deleteByIdForUser.bind(repository)
    repository.deleteByIdForUser = async (...args) => { order.push('row'); return originalRowDelete(...args) }

    await expect(service.deleteDocument(15)).resolves.toEqual({ success: true })
    expect(order).toEqual(['pending', 'file', 'row'])
    expect(repository.documents).toEqual([])
  })

  it('keeps row retryable on file-delete failure', async () => {
    const { service, repository, fileStore } = makeHarness()
    repository.documents.push(document({ id: 16 }))
    fileStore.deleteFailure = new Error('locked by another process')

    await expect(service.deleteDocument(16)).rejects.toMatchObject({ code: 'delete-failed' })
    expect(repository.documents[0]).toMatchObject({ deleteStatus: 'active', lastErrorCode: 'delete-failed' })
    expect(repository.calls).not.toContain('delete-row:7:16')
  })

  it('keeps pending tombstone if DB deletion fails after file removal', async () => {
    const { service, repository, fileStore } = makeHarness()
    repository.documents.push(document({ id: 17 }))
    repository.failDelete = true

    await expect(service.deleteDocument(17)).rejects.toMatchObject({ code: 'delete-failed' })
    expect(fileStore.deleted).toHaveLength(1)
    expect(repository.documents[0]?.deleteStatus).toBe('pending')
  })

  it('repairs a pending delete when file is already gone', async () => {
    const { service, repository, fileStore } = makeHarness()
    const pending = document({ id: 18, deleteStatus: 'pending' })
    const active = document({ id: 19, fileName: 'Keep Me.txt' })
    repository.documents.push(pending, active)

    const rows = await service.listDocuments()
    expect(fileStore.deleted).toEqual([{ localUserId: USER.id, storedRelativePath: pending.storedRelativePath }])
    expect(repository.documents.map((row) => row.id)).toEqual([19])
    expect(rows.map((row) => row.id)).toEqual([19])
  })
})
