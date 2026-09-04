import type {
  VaultDocumentSummary,
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
  onUploadProgress(listener: (progress: VaultUploadProgress) => void): () => void
}
