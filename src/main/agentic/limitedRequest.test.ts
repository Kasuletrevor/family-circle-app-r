import { describe, expect, it, vi } from 'vitest'
import { limitedRequest } from './limitedRequest'

const limits = { maxBytes: 16, timeoutMs: 50 }
const URL = 'https://api.example.test/x'

describe('limitedRequest', () => {
  it('returns the status, type and body, and never sends credentials or follows redirects', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"detail":"no"}', {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })) as unknown as typeof fetch
    const result = await limitedRequest(fetchImpl, URL, { method: 'POST', body: '{}', credentials: 'include' }, limits)
    expect(result.status).toBe(401)
    expect(result.type).toBe('application/json')
    expect(result.bytes.toString('utf8')).toBe('{"detail":"no"}')
    expect(fetchImpl).toHaveBeenCalledWith(URL, expect.objectContaining({ method: 'POST', body: '{}', credentials: 'omit', redirect: 'error' }))
  })

  it('reads an empty body', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
    const result = await limitedRequest(fetchImpl, URL, {}, limits)
    expect(result.status).toBe(204)
    expect(result.bytes.length).toBe(0)
  })

  it('refuses a body over the limit, announced or streamed', async () => {
    const announced = vi.fn(async () => new Response('x', { headers: { 'content-length': '999' } })) as unknown as typeof fetch
    await expect(limitedRequest(announced, URL, {}, limits)).rejects.toThrow('Response too large')
    const streamed = vi.fn(async () => new Response('x'.repeat(17))) as unknown as typeof fetch
    await expect(limitedRequest(streamed, URL, {}, limits)).rejects.toThrow('Response too large')
  })

  it('times out a body that stalls after the headers', async () => {
    const stalled = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]))
        init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')))
      },
    }))) as unknown as typeof fetch
    await expect(limitedRequest(stalled, URL, {}, limits)).rejects.toThrow('aborted')
  })
})
