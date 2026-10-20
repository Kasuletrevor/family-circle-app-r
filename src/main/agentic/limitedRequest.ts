export interface LimitedResponse { status: number; type: string; bytes: Buffer }

/**
 * One request with a size cap and a timeout that covers the whole body. It never sends
 * cookies or follows redirects, and an oversized or endless body is never held in memory.
 * Error statuses come back with their body; only network failures, timeouts and oversized
 * bodies throw.
 */
export async function limitedRequest(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  limits: { maxBytes: number; timeoutMs: number },
): Promise<LimitedResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs)
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal, credentials: 'omit', redirect: 'error' })
    if (Number(response.headers.get('content-length') ?? 0) > limits.maxBytes) throw new Error('Response too large')
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limits.maxBytes) {
        void reader.cancel().catch(() => undefined)
        throw new Error('Response too large')
      }
      chunks.push(value)
    }
    return { status: response.status, type, bytes: Buffer.concat(chunks) }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}
