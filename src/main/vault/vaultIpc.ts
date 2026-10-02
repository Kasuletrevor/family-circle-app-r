import { normalizeStoryLanguage, type StoryLanguage } from '../../shared/story'
import type {
  VaultAnswer,
  VaultDocumentSummary,
  VaultQueryScope,
  VaultUploadBatchResult,
  VaultUploadProgress,
} from '../../shared/desktopApi'
import type { IpcHandleRegistrar } from '../auth/authIpc'
import type { VaultDocumentInternal } from './vaultModels'
import { noMutationLock, type MutationLock } from '../storage/MutationLock'
import type {
  VaultUploadBatchResult as InternalVaultUploadBatchResult,
  VaultUploadProgress as InternalVaultUploadProgress,
} from './VaultService'

export interface VaultIpcService {
  listDocuments(): Promise<VaultDocumentInternal[]>
  chooseAndUploadDocuments(onProgress?: (event: InternalVaultUploadProgress) => void): Promise<InternalVaultUploadBatchResult>
  openDocument(documentId: number): Promise<{ success: true }>
  retryExtraction(documentId: number): Promise<VaultDocumentInternal>
  retryIndexing(documentId: number): Promise<{ success: true }>
  deleteDocument(documentId: number): Promise<{ success: true }>
}

export interface VaultQueryIpcService {
  ask(input: { question: string; scope: VaultQueryScope }): Promise<VaultAnswer>
}

interface VaultIpcEvent {
  sender?: {
    send(channel: string, payload: unknown): void
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function documentIdOf(payload: unknown): number {
  return Number(recordOf(payload).documentId)
}

function issueOf(errorCode: string | null): VaultDocumentSummary['issue'] {
  return errorCode === 'extraction-failed' || errorCode === 'delete-failed' ? errorCode : null
}

type IndexProgressLookup = (documentId: number) => { done: number; total: number } | null

function safeSummary(row: VaultDocumentInternal, indexProgress?: IndexProgressLookup): VaultDocumentSummary {
  const progress = row.indexStatus === 'indexing' ? indexProgress?.(row.id) ?? null : null
  return {
    id: row.id,
    fileName: row.fileName,
    fileType: row.fileType,
    sizeBytes: row.sizeBytes,
    extractionStatus: row.extractionStatus,
    indexStatus: row.indexStatus,
    wordCount: row.wordCount,
    preview: row.preview,
    issue: issueOf(row.lastErrorCode),
    uploadedAt: row.uploadedAt,
    indexProgress: progress && progress.total > 0 ? { done: progress.done, total: progress.total } : null,
  }
}

function safeProgress(event: InternalVaultUploadProgress): VaultUploadProgress {
  return {
    fileIndex: event.fileIndex,
    fileCount: event.fileCount,
    fileName: event.fileName,
    stage: event.stage,
    percent: event.percent,
  }
}

function safeUploadResult(result: InternalVaultUploadBatchResult): VaultUploadBatchResult {
  return {
    canceled: result.canceled,
    items: result.items.map((item) => ({
      fileName: item.fileName,
      outcome: item.outcome,
      ...(item.documentId == null ? {} : { documentId: item.documentId }),
    })),
  }
}

function languageOf(value: unknown): StoryLanguage | undefined {
  try {
    return value == null ? undefined : normalizeStoryLanguage(value).code
  } catch {
    return undefined
  }
}

function queryInputOf(payload: unknown): { question: string; scope: VaultQueryScope; language?: StoryLanguage } {
  const raw = recordOf(payload)
  const language = languageOf(raw.language)
  const scope = recordOf(raw.scope)
  const question = typeof raw.question === 'string' ? raw.question : ''
  const withLanguage = language ? { language } : {}
  if (scope.type === 'all' || scope.type === 'story' || scope.type === 'story-and-vault') {
    return { question, scope: { type: scope.type }, ...withLanguage }
  }
  if (scope.type !== 'documents' || !Array.isArray(scope.documentIds) || scope.documentIds.length === 0) {
    throw new Error('invalid-scope')
  }
  const documentIds = scope.documentIds
  if (documentIds.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('invalid-scope')
  }
  return { question, scope: { type: 'documents', documentIds: [...new Set(documentIds)] }, ...withLanguage }
}

function safeAnswerSources(value: unknown): VaultAnswer['sources'] {
  const sources = Array.isArray(value) ? value : []
  return sources.flatMap((source): VaultAnswer['sources'] => {
    const row = recordOf(source)
    const excerpt = String(row.excerpt ?? '').slice(0, 320)
    if (row.sourceType === 'story') {
      return [{ sourceType: 'story', chapter: String(row.chapter ?? ''), label: String(row.label ?? ''), excerpt }]
    }
    const documentId = Number(row.documentId)
    return Number.isSafeInteger(documentId) && documentId > 0
      ? [{ sourceType: 'document', documentId, fileName: String(row.fileName ?? ''), excerpt }]
      : []
  })
}

function safeAnswer(value: unknown): VaultAnswer {
  const raw = recordOf(value)
  return {
    answer: String(raw.answer ?? ''),
    sources: safeAnswerSources(raw.sources),
  }
}

export function registerVaultIpc(
  ipc: IpcHandleRegistrar,
  service: VaultIpcService,
  queryService?: VaultQueryIpcService,
  mutationLock: MutationLock = noMutationLock,
  indexProgress?: IndexProgressLookup,
): void {
  ipc.handle('vault:list', async () => mutationLock.runExclusive(async () => (
    (await service.listDocuments()).map((row) => safeSummary(row, indexProgress))
  )))
  ipc.handle('vault:choose-and-upload', async (event) => {
    const sender = (event as VaultIpcEvent | null)?.sender
    const result = await mutationLock.runExclusive(() => service.chooseAndUploadDocuments((progress) => {
      sender?.send('vault:upload-progress', safeProgress(progress))
    }))
    return safeUploadResult(result)
  })
  ipc.handle('vault:open', (_event, payload) => service.openDocument(documentIdOf(payload)))
  ipc.handle('vault:retry-extraction', async (_event, payload) => {
    return mutationLock.runExclusive(async () => safeSummary(await service.retryExtraction(documentIdOf(payload))))
  })
  ipc.handle('vault:retry-indexing', (_event, payload) => service.retryIndexing(documentIdOf(payload)))
  ipc.handle('vault:delete', (_event, payload) => mutationLock.runExclusive(() => service.deleteDocument(documentIdOf(payload))))
  if (queryService) {
    ipc.handle('vault:ask', async (_event, payload) => safeAnswer(await queryService.ask(queryInputOf(payload))))
  }
}
