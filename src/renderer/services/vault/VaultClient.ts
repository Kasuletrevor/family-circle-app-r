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
  deleteDocument(documentId: number): Promise<{ success: true }>
  onUploadProgress(listener: (progress: VaultUploadProgress) => void): () => void
}
