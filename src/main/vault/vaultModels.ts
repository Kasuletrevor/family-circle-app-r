export type VaultFileType = 'pdf' | 'docx' | 'txt'
export type VaultExtractionStatus = 'pending' | 'extracting' | 'ready' | 'failed'
export type VaultIndexStatus = 'not_indexed' | 'waiting_for_ai' | 'indexing' | 'indexed' | 'failed'
export type VaultDeleteStatus = 'active' | 'pending'

export interface VaultDocumentInternal {
  id: number
  localUserId: number
  fileName: string
  fileType: VaultFileType
  mimeType: string
  sizeBytes: number
  sha256: string
  storedRelativePath: string
  extractionStatus: VaultExtractionStatus
  indexStatus: VaultIndexStatus
  wordCount: number
  preview: string | null
  extractedText: string | null
  lastErrorCode: string | null
  deleteStatus: VaultDeleteStatus
  uploadedAt: number
  updatedAt: number
}

export interface InsertStoredDocumentInput {
  localUserId: number
  fileName: string
  fileType: VaultFileType
  mimeType: string
  sizeBytes: number
  sha256: string
  storedRelativePath: string
  extractionStatus?: VaultExtractionStatus
  indexStatus?: VaultIndexStatus
}

export interface VaultExtractionSuccess {
  extractedText: string
  wordCount: number
  preview: string
}
