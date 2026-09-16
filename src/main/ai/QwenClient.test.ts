import { describe, expect, it, vi } from 'vitest'
import { QwenClient, QwenClientError, type QwenHttpPort } from './QwenClient'

const SYSTEM = 'You are a private family-knowledge assistant. Answer using ONLY the provided private source context. If the answer is not supported by the context, say you could not find it in the selected private sources.'

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
        { role: 'user' },
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
})
