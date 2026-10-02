import { describe, expect, it, vi } from 'vitest'
import { QwenClient, QwenClientError, type QwenHttpPort } from './QwenClient'

const SYSTEM = 'You are a private family-knowledge assistant. Answer using ONLY the provided private source context. If the answer is not supported by the context, reply with exactly NOT_FOUND and nothing else. Otherwise reply in plain text without Markdown, in a few short sentences, and do not refer to "the context" or "the sources".'

describe('QwenClient', () => {
  it('uses the 192-token ceiling for normal grounded answers', async () => {
    const post = vi.fn(async () => ({ choices: [{ message: { content: 'A grounded answer.' } }] }))
    const client = new QwenClient({ http: { post } as QwenHttpPort })

    await expect(client.generateFast('What did I say?', '[My Story] I said hello.')).resolves.toBe('A grounded answer.')

    expect(post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      max_tokens: 192,
      temperature: 0,
      top_k: 40,
      top_p: 0.95,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM },
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('What did I say?'),
        }),
      ],
    }))
  })

  it('uses the 384-token ceiling for complex grounded answers', async () => {
    const post = vi.fn(async () => ({ choices: [{ message: { content: 'A complex grounded answer.' } }] }))
    const client = new QwenClient({ http: { post } as QwenHttpPort })

    await expect(client.generateComplex('Compare these.', 'Source 1\nA\n\nSource 2\nB')).resolves.toBe('A complex grounded answer.')

    expect(post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      max_tokens: 384,
      temperature: 0,
      stream: false,
    }))
  })

  it('uses a short deterministic translation request for multilingual retrieval', async () => {
    const post = vi.fn(async () => ({ choices: [{ message: { content: 'Where was I born?' } }] }))
    const client = new QwenClient({ http: { post } as QwenHttpPort })

    await expect(client.translateForRetrieval('¿Dónde nací?')).resolves.toBe('Where was I born?')

    expect(post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      max_tokens: 96,
      temperature: 0,
      stream: false,
    }))
  })

  it('maps empty responses and transport errors to stable generation-failed', async () => {
    const empty = new QwenClient({ http: { post: vi.fn(async () => ({ choices: [] })) } })
    await expect(empty.generateFast('Question', 'Context')).rejects.toMatchObject({ code: 'generation-failed' })

    const failed = new QwenClient({ http: { post: vi.fn(async () => { throw new Error('offline') }) } })
    await expect(failed.generateComplex('Question', 'Context')).rejects.toBeInstanceOf(QwenClientError)
  })

  it('returns plain text when the model still answers in Markdown', async () => {
    // Real Qwen3.5 0.8B output; the answer is rendered as plain text in the app.
    const markdown = [
      'Based on the provided private source context:',
      '*   The land title is kept in a **locked tin box in the main bedroom**.',
      '*   The executor of the will is **Grace Nakato**.',
    ].join('\n')
    const post = vi.fn(async () => ({ choices: [{ message: { content: markdown } }] }))
    const client = new QwenClient({ http: { post } as QwenHttpPort })

    await expect(client.generateFast('Where is the land title?', 'context')).resolves.toBe([
      'Based on the provided private source context:',
      '• The land title is kept in a locked tin box in the main bedroom.',
      '• The executor of the will is Grace Nakato.',
    ].join('\n'))
  })

  it('asks for the answer in the selected language, keeping the NOT_FOUND contract', async () => {
    const post = vi.fn(async () => ({ choices: [{ message: { content: 'Elle est née à Masaka.' } }] }))
    const client = new QwenClient({ http: { post } as QwenHttpPort })

    await expect(client.generateFast('Où est-elle née ?', 'context', 'French')).resolves.toBe('Elle est née à Masaka.')
    const body = post.mock.calls[0]![1] as { messages: Array<{ role: string; content: string }> }
    expect(body.messages[0]!.content).toContain('reply with exactly NOT_FOUND')
    expect(body.messages[0]!.content).toContain('Write the complete answer in French.')

    await client.generateFast('Where was she born?', 'context')
    const englishBody = post.mock.calls[1]![1] as { messages: Array<{ role: string; content: string }> }
    expect(englishBody.messages[0]!.content).toBe(SYSTEM)
  })
})
