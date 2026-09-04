import { describe, expect, it, vi } from 'vitest'
import { NomicClient } from './NomicClient'

function makeClient(responses: unknown[]) {
  const values = [...responses]
  const http = {
    post: vi.fn(async () => values.shift()),
  }
  return { client: new NomicClient({ http }), http }
}

describe('NomicClient local embeddings', () => {
  it('uses exact search_document prefix for document chunks', async () => {
    const { client, http } = makeClient([[{ embedding: [0.25, -1.5] }]])

    await expect(client.embedDocument('family history')).resolves.toEqual(new Float32Array([0.25, -1.5]))
    expect(http.post).toHaveBeenCalledWith('/embedding', { content: 'search_document: family history' })
  })

  it('uses exact search_query prefix for questions', async () => {
    const { client, http } = makeClient([{ embedding: [1, 2, 3] }])

    await expect(client.embedQuery('Who was Ada?')).resolves.toEqual(new Float32Array([1, 2, 3]))
    expect(http.post).toHaveBeenCalledWith('/embedding', { content: 'search_query: Who was Ada?' })
  })

  it('normalizes supported llama.cpp embedding response shapes', async () => {
    const { client } = makeClient([
      [{ embedding: [1, 2] }],
      { embedding: [3, 4] },
      [5, 6],
    ])

    expect([...await client.embedDocument('one')]).toEqual([1, 2])
    expect([...await client.embedDocument('two')]).toEqual([3, 4])
    expect([...await client.embedDocument('three')]).toEqual([5, 6])
  })

  it('maps empty and non-numeric vectors to stable embedding-failed', async () => {
    for (const response of [[], { embedding: [] }, { embedding: [1, 'bad'] }, { unexpected: true }]) {
      const { client } = makeClient([response])
      await expect(client.embedQuery('question')).rejects.toMatchObject({ code: 'embedding-failed' })
    }
  })
})
