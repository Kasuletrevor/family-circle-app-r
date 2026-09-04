import { request as httpRequest } from 'node:http'

export interface NomicHttpPort {
  post(path: string, body: unknown): Promise<unknown>
}

interface NomicClientDependencies {
  http?: NomicHttpPort
}

export class NomicClientError extends Error {
  readonly code = 'embedding-failed'

  constructor() {
    super('Local embedding failed')
    this.name = 'NomicClientError'
  }
}

class LocalNomicHttpPort implements NomicHttpPort {
  async post(path: string, body: unknown): Promise<unknown> {
    const payload = JSON.stringify(body)
    return new Promise((resolve, reject) => {
      const request = httpRequest({
        host: '127.0.0.1',
        port: 8081,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        },
        timeout: 30_000,
      }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer | Uint8Array | string) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          const status = response.statusCode ?? 0
          if (status < 200 || status >= 300) {
            reject(new NomicClientError())
            return
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new NomicClientError())
          }
        })
      })
      request.once('timeout', () => {
        request.destroy()
        reject(new NomicClientError())
      })
      request.once('error', () => reject(new NomicClientError()))
      request.write(payload)
      request.end()
    })
  }
}

function numericVector(response: unknown): number[] | null {
  let candidate: unknown = response
  if (Array.isArray(response) && !response.every((value) => typeof value === 'number')) {
    const first = response[0]
    candidate = first && typeof first === 'object' && 'embedding' in first
      ? (first as { embedding?: unknown }).embedding
      : null
  } else if (response && typeof response === 'object' && !Array.isArray(response) && 'embedding' in response) {
    candidate = (response as { embedding?: unknown }).embedding
  }

  if (!Array.isArray(candidate) || candidate.length === 0) return null
  if (!candidate.every((value) => typeof value === 'number' && Number.isFinite(value))) return null
  return candidate as number[]
}

export class NomicClient {
  private readonly http: NomicHttpPort

  constructor(dependencies: NomicClientDependencies = {}) {
    this.http = dependencies.http ?? new LocalNomicHttpPort()
  }

  async embedDocument(chunk: string): Promise<Float32Array> {
    return this.embed(`search_document: ${chunk}`)
  }

  async embedQuery(question: string): Promise<Float32Array> {
    return this.embed(`search_query: ${question}`)
  }

  private async embed(content: string): Promise<Float32Array> {
    try {
      const response = await this.http.post('/embedding', { content })
      const values = numericVector(response)
      if (!values) throw new NomicClientError()
      return new Float32Array(values)
    } catch (error) {
      if (error instanceof NomicClientError) throw error
      throw new NomicClientError()
    }
  }
}
