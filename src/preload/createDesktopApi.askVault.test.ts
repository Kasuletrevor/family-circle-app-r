import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './createDesktopApi'

describe('createDesktopApi Vault ask', () => {
  it('invokes only vault:ask and strips private fields from answer sources', async () => {
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel !== 'vault:ask') return undefined
      expect(payload).toEqual({ question: 'Where was grandmother born?', scope: { type: 'all' } })
      return {
        answer: 'She was born in Jinja.',
        sources: [{
          documentId: 3,
          fileName: 'History.pdf',
          excerpt: 'She was born in Jinja.',
          embedding: [0.1, 0.2],
          storedRelativePath: 'vault/private.pdf',
          extractedText: 'full private text',
          modelPath: 'secret',
        }],
        localUserId: 7,
      }
    })
    const api = createDesktopApi(invoke)
    const ask = (api.vault as unknown as {
      ask(input: { question: string; scope: { type: 'all' } }): Promise<unknown>
    }).ask

    expect(ask).toBeTypeOf('function')
    const result = await ask({ question: 'Where was grandmother born?', scope: { type: 'all' } })
    expect(invoke).toHaveBeenCalledWith('vault:ask', { question: 'Where was grandmother born?', scope: { type: 'all' } })
    expect(result).toEqual({
      answer: 'She was born in Jinja.',
      sources: [{ documentId: 3, fileName: 'History.pdf', excerpt: 'She was born in Jinja.' }],
    })
    expect(JSON.stringify(result)).not.toMatch(/embedding|storedRelativePath|extractedText|modelPath|localUserId/)
  })
})
