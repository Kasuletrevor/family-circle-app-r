import { describe, expect, it, vi } from 'vitest'
import { registerVaultIpc } from './vaultIpc'

function registrar() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    ipc: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) },
  }
}

describe('Vault ask IPC', () => {
  it('registers vault:ask and reconstructs only question plus numeric scope ids', async () => {
    const { ipc, handlers } = registrar()
    const vault = {
      listDocuments: vi.fn(), chooseAndUploadDocuments: vi.fn(), openDocument: vi.fn(), retryExtraction: vi.fn(),
      retryIndexing: vi.fn(), deleteDocument: vi.fn(),
    }
    const ask = vi.fn(async () => ({
      answer: 'Grounded answer',
      sources: [{ documentId: 4, fileName: 'History.pdf', excerpt: 'Safe excerpt', embedding: [1, 2], storedRelativePath: 'secret' }],
      localUserId: 7,
      modelPath: 'secret-model',
    }))

    ;(registerVaultIpc as unknown as (ipc: unknown, vault: unknown, query: { ask: typeof ask }) => void)(ipc, vault, { ask })
    const handler = handlers.get('vault:ask')
    expect(handler).toBeTypeOf('function')

    const result = await handler?.({}, {
      question: 'Who founded the family?',
      scope: { type: 'documents', documentIds: [4, 9] },
      localUserId: 999,
      path: 'C:/secret',
      endpoint: 'http://127.0.0.1:8080',
    })

    expect(ask).toHaveBeenCalledWith({
      question: 'Who founded the family?',
      scope: { type: 'documents', documentIds: [4, 9] },
    })
    expect(result).toEqual({
      answer: 'Grounded answer',
      sources: [{ documentId: 4, fileName: 'History.pdf', excerpt: 'Safe excerpt' }],
    })
  })

  it('rejects selected scopes containing non-numeric ids before query service', async () => {
    const { ipc, handlers } = registrar()
    const ask = vi.fn()
    ;(registerVaultIpc as unknown as (ipc: unknown, vault: unknown, query: { ask: typeof ask }) => void)(ipc, {}, { ask })

    const handler = handlers.get('vault:ask')
    await expect(Promise.resolve(handler?.({}, {
      question: 'Question',
      scope: { type: 'documents', documentIds: [4, '9'] },
    }))).rejects.toThrow()
    expect(ask).not.toHaveBeenCalled()
  })
})
