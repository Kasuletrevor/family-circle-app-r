import { request as httpRequest } from 'node:http'

const GENERATION_PORT = 8080
const SYSTEM_INSTRUCTION = 'You are a private family-knowledge assistant. Answer using ONLY the provided private source context. If the answer is not supported by the context, say you could not find it in the selected private sources.'
const TRANSLATION_INSTRUCTION = 'Translate the search question into English for retrieval. Return only the translated question. Preserve every name, date, number, and place exactly.'

export interface QwenHttpPort {
  post(path: string, body: unknown): Promise<unknown>
}

interface QwenClientDependencies {
  http?: QwenHttpPort
}

export class QwenClientError extends Error {
  readonly code = 'generation-failed'

  constructor() {
    super('Private AI answer generation failed')
    this.name = 'QwenClientError'
  }
}

class LocalQwenHttpPort implements QwenHttpPort {
  async post(path: string, body: unknown): Promise<unknown> {
    const payload = JSON.stringify(body)
    return new Promise((resolve, reject) => {
      const request = httpRequest({
        host: '127.0.0.1',
        port: GENERATION_PORT,
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
            reject(new QwenClientError())
            return
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new QwenClientError())
          }
        })
      })
      request.once('timeout', () => {
        request.destroy()
        reject(new QwenClientError())
      })
      request.once('error', () => reject(new QwenClientError()))
      request.write(payload)
      request.end()
    })
  }
}

function responseText(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null
  const choices = (response as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first = choices[0]
  if (!first || typeof first !== 'object') return null
  const message = (first as { message?: unknown }).message
  if (!message || typeof message !== 'object') return null
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' && content.trim() ? content.trim() : null
}

function cleanTranslation(value: string): string {
  return value
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^(?:english(?: translation)?|translation|translated query)\s*:\s*/i, '')
    .replace(/^['"]|['"]$/g, '')
    .trim()
}

export class QwenClient {
  private readonly http: QwenHttpPort

  constructor(dependencies: QwenClientDependencies = {}) {
    this.http = dependencies.http ?? new LocalQwenHttpPort()
  }

  async generateFast(question: string, context: string): Promise<string> {
    return this.generate(question, context, 192)
  }

  async generateComplex(question: string, context: string): Promise<string> {
    return this.generate(question, context, 384)
  }

  async translateForRetrieval(question: string): Promise<string> {
    const translated = await this.complete({
      messages: [
        { role: 'system', content: TRANSLATION_INSTRUCTION },
        { role: 'user', content: String(question || '').trim() },
      ],
      max_tokens: 96,
      temperature: 0,
      stream: false,
    })
    const cleaned = cleanTranslation(translated)
    if (!cleaned || cleaned.length > 1_000) throw new QwenClientError()
    return cleaned
  }

  private async generate(question: string, context: string, maxTokens: number): Promise<string> {
    return this.complete({
      messages: [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user', content: `Private source context:\n${context}\n\nQuestion:\n${question}` },
      ],
      max_tokens: maxTokens,
      temperature: 0,
      top_k: 40,
      top_p: 0.95,
      stream: false,
    })
  }

  private async complete(body: unknown): Promise<string> {
    try {
      const response = await this.http.post('/v1/chat/completions', body)
      const text = responseText(response)
      if (!text) throw new QwenClientError()
      return text
    } catch (error) {
      if (error instanceof QwenClientError) throw error
      throw new QwenClientError()
    }
  }
}
