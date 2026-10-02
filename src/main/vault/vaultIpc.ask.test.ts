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
      sources: [{ sourceType: 'document', documentId: 4, fileName: 'History.pdf', excerpt: 'Safe excerpt' }],
    })
  })

  it('accepts My Story scopes and strips private fields from Story sources', async () => {
    const { ipc, handlers } = registrar()
    const ask = vi.fn(async () => ({
      answer: 'I studied at Makerere.',
      sources: [{ sourceType: 'story', chapter: 'Life Story', label: 'Learning and education', excerpt: 'Makerere', localUserId: 7, fieldKey: 'secret' }],
    }))
    ;(registerVaultIpc as unknown as (ipc: unknown, vault: unknown, query: { ask: typeof ask }) => void)(ipc, {}, { ask })
    const handler = handlers.get('vault:ask')

    await handler?.({}, { question: 'Where?', scope: { type: 'story', documentIds: [1], localUserId: 9 } })
    expect(ask).toHaveBeenLastCalledWith({ question: 'Where?', scope: { type: 'story' } })

    const result = await handler?.({}, { question: 'Where?', scope: { type: 'story-and-vault' } })
    expect(ask).toHaveBeenLastCalledWith({ question: 'Where?', scope: { type: 'story-and-vault' } })
    expect(result).toEqual({
      answer: 'I studied at Makerere.',
      sources: [{ sourceType: 'story', chapter: 'Life Story', label: 'Learning and education', excerpt: 'Makerere' }],
    })

    await expect(Promise.resolve(handler?.({}, { question: 'Where?', scope: { type: 'everything-else' } }))).rejects.toThrow()
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

  it('passes a supported question language through and drops anything else', async () => {
    const { ipc, handlers } = registrar()
    const ask = vi.fn(async () => ({ answer: 'Réponse', sources: [] }))
    ;(registerVaultIpc as unknown as (ipc: unknown, vault: unknown, query: { ask: typeof ask }) => void)(ipc, {}, { ask })
    const handler = handlers.get('vault:ask')

    await handler?.({}, { question: 'Où ?', scope: { type: 'all' }, language: 'fr-FR' })
    expect(ask).toHaveBeenLastCalledWith({ question: 'Où ?', scope: { type: 'all' }, language: 'fr' })

    await handler?.({}, { question: 'Where?', scope: { type: 'story' }, language: 'klingon' })
    expect(ask).toHaveBeenLastCalledWith({ question: 'Where?', scope: { type: 'story' } })
  })
})
