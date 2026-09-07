import { describe, expect, it, vi } from 'vitest'
import { DesktopVaultClient } from './DesktopVaultClient'

describe('DesktopVaultClient ask', () => {
  it('delegates question and scope through the desktop Vault ask operation without list invalidation', async () => {
    const listDocuments = vi.fn(async () => [])
    const ask = vi.fn(async () => ({
      answer: 'Grounded answer',
      sources: [{ documentId: 4, fileName: 'History.pdf', excerpt: 'Safe excerpt' }],
    }))
    const client = new DesktopVaultClient({ listDocuments, ask } as never)
    const callable = client as unknown as {
      ask(question: string, scope: { type: 'documents'; documentIds: number[] }): Promise<unknown>
    }

    await client.listDocuments()
    const result = await callable.ask('Who founded the family?', { type: 'documents', documentIds: [4] })
    await client.listDocuments()

    expect(ask).toHaveBeenCalledWith({
      question: 'Who founded the family?',
      scope: { type: 'documents', documentIds: [4] },
    })
    expect(result).toEqual({
      answer: 'Grounded answer',
      sources: [{ documentId: 4, fileName: 'History.pdf', excerpt: 'Safe excerpt' }],
    })
    expect(listDocuments).toHaveBeenCalledTimes(2)
  })
})
