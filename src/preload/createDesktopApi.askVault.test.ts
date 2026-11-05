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
      sources: [{ sourceType: 'document', documentId: 3, fileName: 'History.pdf', excerpt: 'She was born in Jinja.' }],
    })
    expect(JSON.stringify(result)).not.toMatch(/embedding|storedRelativePath|extractedText|modelPath|localUserId/)
  })

  it('passes the general-knowledge mark only when it is exactly true', async () => {
    const replies: unknown[] = [{ answer: 'It is 16:09.', sources: [], general: true }, { answer: 'x', sources: [], general: 'yes' }]
    const api = createDesktopApi(vi.fn(async () => replies.shift()))
    await expect(api.vault.ask({ question: 'What time is it?', scope: { type: 'all' } })).resolves.toEqual({ answer: 'It is 16:09.', sources: [], general: true })
    await expect(api.vault.ask({ question: 'x', scope: { type: 'all' } })).resolves.toEqual({ answer: 'x', sources: [] })
  })

  it('sends only a supported language code', async () => {
    const invoke = vi.fn(async () => ({ answer: 'ok', sources: [] }))
    const api = createDesktopApi(invoke)
    await api.vault.ask({ question: '¿Dónde?', scope: { type: 'all' }, language: 'es' })
    expect(invoke).toHaveBeenLastCalledWith('vault:ask', { question: '¿Dónde?', scope: { type: 'all' }, language: 'es' })
    await api.vault.ask({ question: 'Where?', scope: { type: 'all' }, language: 'xx' as never })
    expect(invoke).toHaveBeenLastCalledWith('vault:ask', { question: 'Where?', scope: { type: 'all' } })
  })
})
