import type {
  DesktopApi,
  VaultDocumentSummary,
  VaultUploadProgress,
} from '../../../shared/desktopApi'
import type { VaultClient } from './VaultClient'

type VaultDesktopOperations = DesktopApi['vault']

const defaultOperations: VaultDesktopOperations = {
  listDocuments: () => window.familyCircle.vault.listDocuments(),
  chooseAndUploadDocuments: () => window.familyCircle.vault.chooseAndUploadDocuments(),
  openDocument: (input) => window.familyCircle.vault.openDocument(input),
  retryExtraction: (input) => window.familyCircle.vault.retryExtraction(input),
  deleteDocument: (input) => window.familyCircle.vault.deleteDocument(input),
  onUploadProgress: (listener) => window.familyCircle.vault.onUploadProgress(listener),
}

export class DesktopVaultClient implements VaultClient {
  private listInFlight: Promise<VaultDocumentSummary[]> | null = null
  private readonly operations: VaultDesktopOperations

  constructor(operations: Partial<VaultDesktopOperations> = {}) {
    this.operations = { ...defaultOperations, ...operations }
  }

  listDocuments(): Promise<VaultDocumentSummary[]> {
    if (this.listInFlight) return this.listInFlight

    const request = this.operations.listDocuments()
    this.listInFlight = request
    void request.then(
      () => {
        if (this.listInFlight === request) this.listInFlight = null
      },
      () => {
        if (this.listInFlight === request) this.listInFlight = null
      },
    )
    return request
  }

  async chooseAndUploadDocuments() {
    try {
      return await this.operations.chooseAndUploadDocuments()
    } finally {
      this.invalidateList()
    }
  }

  openDocument(documentId: number) {
    return this.operations.openDocument({ documentId })
  }

  async retryExtraction(documentId: number) {
    try {
      return await this.operations.retryExtraction({ documentId })
    } finally {
      this.invalidateList()
    }
  }

  async deleteDocument(documentId: number) {
    try {
      return await this.operations.deleteDocument({ documentId })
    } finally {
      this.invalidateList()
    }
  }

  onUploadProgress(listener: (progress: VaultUploadProgress) => void): () => void {
    return this.operations.onUploadProgress(listener)
  }

  private invalidateList(): void {
    this.listInFlight = null
  }
}
