import { describe, expect, it, vi } from 'vitest'
import { registerVaultIpc } from './vaultIpc'

describe('Vault retry indexing IPC', () => {
  it('reconstructs only numeric documentId and delegates ownership derivation to main service', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    }
    const service = {
      listDocuments: vi.fn(async () => []),
      chooseAndUploadDocuments: vi.fn(async () => ({ canceled: true, items: [] })),
      openDocument: vi.fn(async () => ({ success: true as const })),
      retryExtraction: vi.fn(async () => { throw new Error('not used') }),
      retryIndexing: vi.fn(async () => ({ success: true as const })),
      deleteDocument: vi.fn(async () => ({ success: true as const })),
    }

    registerVaultIpc(ipc as never, service as never)
    expect(handlers.has('vault:retry-indexing')).toBe(true)

    const malicious = {
      documentId: '44',
      localUserId: 999,
      path: 'C:/attacker',
      url: 'https://attacker.example',
      modelPath: 'C:/attacker/model.gguf',
      endpoint: 'http://127.0.0.1:9999',
    }
    await expect(handlers.get('vault:retry-indexing')?.({}, malicious)).resolves.toEqual({ success: true })
    expect(service.retryIndexing).toHaveBeenCalledWith(44)
  })
})
