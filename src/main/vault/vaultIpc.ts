import type {
  VaultAnswer,
  VaultDocumentSummary,
  VaultQueryScope,
  VaultUploadBatchResult,
  VaultUploadProgress,
} from '../../shared/desktopApi'
import type { IpcHandleRegistrar } from '../auth/authIpc'
import type { VaultDocumentInternal } from './vaultModels'
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

function safeSummary(row: VaultDocumentInternal): VaultDocumentSummary {
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

function queryInputOf(payload: unknown): { question: string; scope: VaultQueryScope } {
  const raw = recordOf(payload)
  const scope = recordOf(raw.scope)
  if (scope.type === 'all') {
    return { question: typeof raw.question === 'string' ? raw.question : '', scope: { type: 'all' } }
  }
  if (scope.type !== 'documents' || !Array.isArray(scope.documentIds) || scope.documentIds.length === 0) {
    throw new Error('invalid-scope')
  }
  const documentIds = scope.documentIds
  if (documentIds.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('invalid-scope')
  }
  return {
    question: typeof raw.question === 'string' ? raw.question : '',
    scope: { type: 'documents', documentIds: [...new Set(documentIds)] },
  }
}

function safeAnswer(value: unknown): VaultAnswer {
  const raw = recordOf(value)
  const sources = Array.isArray(raw.sources) ? raw.sources : []
  return {
    answer: String(raw.answer ?? ''),
    sources: sources.map((source) => {
      const row = recordOf(source)
      return {
        documentId: Number(row.documentId),
        fileName: String(row.fileName ?? ''),
        excerpt: String(row.excerpt ?? '').slice(0, 320),
      }
    }).filter((source) => Number.isSafeInteger(source.documentId) && source.documentId > 0),
  }
}

export function registerVaultIpc(
  ipc: IpcHandleRegistrar,
  service: VaultIpcService,
  queryService?: VaultQueryIpcService,
): void {
  ipc.handle('vault:list', async () => (await service.listDocuments()).map(safeSummary))
  ipc.handle('vault:choose-and-upload', async (event) => {
    const sender = (event as VaultIpcEvent | null)?.sender
    const result = await service.chooseAndUploadDocuments((progress) => {
      sender?.send('vault:upload-progress', safeProgress(progress))
    })
    return safeUploadResult(result)
  })
  ipc.handle('vault:open', (_event, payload) => service.openDocument(documentIdOf(payload)))
  ipc.handle('vault:retry-extraction', async (_event, payload) => {
    return safeSummary(await service.retryExtraction(documentIdOf(payload)))
  })
  ipc.handle('vault:retry-indexing', (_event, payload) => service.retryIndexing(documentIdOf(payload)))
  ipc.handle('vault:delete', (_event, payload) => service.deleteDocument(documentIdOf(payload)))
  if (queryService) {
    ipc.handle('vault:ask', async (_event, payload) => safeAnswer(await queryService.ask(queryInputOf(payload))))
  }
}
