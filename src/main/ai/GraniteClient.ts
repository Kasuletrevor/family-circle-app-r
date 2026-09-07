import { request as httpRequest } from 'node:http'

const SYSTEM_INSTRUCTION = 'You are a private family-knowledge assistant. Answer using ONLY the provided Vault source context. If the answer is not supported by the context, say you could not find it in the selected Vault documents.'

export interface GraniteHttpPort {
  post(path: string, body: unknown): Promise<unknown>
}

interface GraniteClientDependencies {
  http?: GraniteHttpPort
}

export class GraniteClientError extends Error {
  readonly code = 'generation-failed'

  constructor() {
    super('Local answer generation failed')
    this.name = 'GraniteClientError'
  }
}

class LocalGraniteHttpPort implements GraniteHttpPort {
  async post(path: string, body: unknown): Promise<unknown> {
    const payload = JSON.stringify(body)
    return new Promise((resolve, reject) => {
      const request = httpRequest({
        host: '127.0.0.1',
        port: 8080,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        },
        timeout: 60_000,
      }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer | Uint8Array | string) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          const status = response.statusCode ?? 0
          if (status < 200 || status >= 300) {
            reject(new GraniteClientError())
            return
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new GraniteClientError())
          }
        })
      })
      request.once('timeout', () => {
        request.destroy()
        reject(new GraniteClientError())
      })
      request.once('error', () => reject(new GraniteClientError()))
      request.write(payload)
      request.end()
    })
  }
}

function answerText(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null
  const choices = (response as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first = choices[0]
  if (!first || typeof first !== 'object') return null
  const message = (first as { message?: unknown }).message
  if (!message || typeof message !== 'object') return null
  const content = (message as { content?: unknown }).content
  if (typeof content !== 'string' || !content.trim()) return null
  return content.trim()
}

export class GraniteClient {
  private readonly http: GraniteHttpPort

  constructor(dependencies: GraniteClientDependencies = {}) {
    this.http = dependencies.http ?? new LocalGraniteHttpPort()
  }

  async generate(question: string, context: string): Promise<string> {
    try {
      const response = await this.http.post('/v1/chat/completions', {
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          {
            role: 'user',
            content: `Vault source context:\n${context}\n\nQuestion:\n${question}`,
          },
        ],
        max_tokens: 512,
        temperature: 0,
        top_k: 40,
        top_p: 0.95,
        stream: false,
      })
      const answer = answerText(response)
      if (!answer) throw new GraniteClientError()
      return answer
    } catch (error) {
      if (error instanceof GraniteClientError) throw error
      throw new GraniteClientError()
    }
  }
}
