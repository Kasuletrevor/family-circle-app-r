import type {
  VaultAnswer,
  VaultDocumentSummary,
  VaultQueryScope,
  VaultUploadBatchResult,
  VaultUploadProgress,
} from '../../../shared/desktopApi'

export interface VaultClient {
  listDocuments(): Promise<VaultDocumentSummary[]>
  chooseAndUploadDocuments(): Promise<VaultUploadBatchResult>
  openDocument(documentId: number): Promise<{ success: true }>
  retryExtraction(documentId: number): Promise<VaultDocumentSummary>
  retryIndexing(documentId: number): Promise<{ success: true }>
  deleteDocument(documentId: number): Promise<{ success: true }>
  ask(question: string, scope: VaultQueryScope): Promise<VaultAnswer>
  onUploadProgress(listener: (progress: VaultUploadProgress) => void): () => void
}
