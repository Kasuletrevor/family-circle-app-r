import { describe, expect, it, vi } from 'vitest'
import { GraniteClient, GraniteClientError, type GraniteHttpPort } from './GraniteClient'

const SYSTEM = 'You are a private family-knowledge assistant. Answer using ONLY the provided Vault source context. If the answer is not supported by the context, say you could not find it in the selected Vault documents.'

describe('GraniteClient', () => {
  it('posts a deterministic grounded chat request to the local Granite endpoint', async () => {
    const post = vi.fn(async () => ({ choices: [{ message: { content: 'Grandmother was born in Jinja.' } }] }))
    const client = new GraniteClient({ http: { post } as GraniteHttpPort })

    await expect(client.generate('Where was grandmother born?', 'Source 1\nShe was born in Jinja.')).resolves.toBe('Grandmother was born in Jinja.')
    expect(post).toHaveBeenCalledTimes(1)
    const [path, body] = post.mock.calls[0]!
    expect(path).toBe('/v1/chat/completions')
    expect(body).toMatchObject({
      max_tokens: 512,
      temperature: 0,
      top_k: 40,
      top_p: 0.95,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user' },
      ],
    })
    const user = (body as { messages: Array<{ role: string; content: string }> }).messages[1]!.content
    expect(user).toContain('Where was grandmother born?')
    expect(user).toContain('Source 1\nShe was born in Jinja.')
  })

  it('maps empty responses and transport errors to stable generation-failed', async () => {
    const empty = new GraniteClient({ http: { post: vi.fn(async () => ({ choices: [] })) } })
    await expect(empty.generate('Question', 'Context')).rejects.toMatchObject({ code: 'generation-failed' })

    const failed = new GraniteClient({ http: { post: vi.fn(async () => { throw new Error('offline') }) } })
    await expect(failed.generate('Question', 'Context')).rejects.toBeInstanceOf(GraniteClientError)
    await expect(failed.generate('Question', 'Context')).rejects.toMatchObject({ code: 'generation-failed' })
  })
})
