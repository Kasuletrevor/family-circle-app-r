import { request as httpRequest } from 'node:http'
import type { ChatTurn } from '../../shared/agenticChat'

const GENERATION_PORT = 8080
// Both prompts were tuned on Granite 4.0 1B. Without the current date and time it answers
// "what time is it?" with NOT_FOUND, and without "complete sentences" it replies in two words.
const groundedInstruction = (now: string) => `You are a private family-knowledge assistant running on this computer. It is now ${now}. Answer the question using the private source context, and use the current date and time when the question needs them, for example to work out an age or how long until a date. Reply in one to three complete sentences of plain text without Markdown, and do not refer to "the context" or "the sources". If the private source context does not answer the question, reply with exactly NOT_FOUND and nothing else.`
// Used only after the private sources did not answer. Granite then refuses family questions
// (NOT_FOUND or "I do not know") instead of inventing a blood type or a key's hiding place.
const generalInstruction = (now: string) => `You are a helpful assistant running privately on this computer. It is now ${now}. Answer general questions, such as the date or time, geography, history, science or arithmetic, from general knowledge in one to three complete sentences of plain text without Markdown. You know nothing about this person, their family, their home, their health or their documents. If the question is about any of those, reply with exactly NOT_FOUND and nothing else. If you are not sure of the answer, say that you do not know.`
const TRANSLATION_INSTRUCTION = 'Translate the search question into English for retrieval. Return only the translated question. Preserve every name, date, number, and place exactly.'

export interface QwenHttpPort {
  post(path: string, body: unknown): Promise<unknown>
}

interface QwenClientDependencies {
  http?: QwenHttpPort
  /** The current time and the computer's time zone; fixed in tests. */
  now?: () => Date
  timeZone?: string
}

/** For example "Thursday, 5 November 2026 at 16:09 GMT+3 (Africa/Kampala)". */
export function describeNow(date: Date, timeZone?: string): string {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const text = date.toLocaleString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: zone,
  })
  return zone ? `${text} (${zone})` : text
}

function inLanguage(instruction: string, languageLabel?: string): string {
  return languageLabel && languageLabel !== 'English'
    ? `${instruction} Write the complete answer in ${languageLabel}. If the sources or the question are in another language, translate the answer into ${languageLabel}. Keep names, dates, numbers and quotations exact.`
    : instruction
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

// Answers are shown as plain text, so drop Markdown emphasis and turn list markers into bullets.
function plainAnswer(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^[ \t]*[*-][ \t]+/gm, '• ')
    .replace(/^#{1,6}[ \t]+/gm, '')
    .trim()
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
  private readonly now: () => Date
  private readonly timeZone?: string

  constructor(dependencies: QwenClientDependencies = {}) {
    this.http = dependencies.http ?? new LocalQwenHttpPort()
    this.now = dependencies.now ?? (() => new Date())
    this.timeZone = dependencies.timeZone
  }

  /** `languageLabel` (for example "French") asks for the answer in that language; English is the default. */
  async generateFast(question: string, context: string, languageLabel?: string): Promise<string> {
    return this.generate(question, context, 192, languageLabel)
  }

  async generateComplex(question: string, context: string, languageLabel?: string): Promise<string> {
    return this.generate(question, context, 384, languageLabel)
  }

  /** A general question (the date, geography, ...) the private sources did not answer. */
  async generateGeneral(question: string, languageLabel?: string): Promise<string> {
    const answer = await this.complete({
      messages: [
        { role: 'system', content: inLanguage(generalInstruction(describeNow(this.now(), this.timeZone)), languageLabel) },
        { role: 'user', content: question },
      ],
      max_tokens: 192,
      temperature: 0,
      top_k: 40,
      top_p: 0.95,
      stream: false,
    })
    return plainAnswer(answer)
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

  /** An angel conversation turn: Family Circle builds the whole prompt, the model only writes. */
  async chat(messages: ChatTurn[], maxTokens: number): Promise<string> {
    const answer = await this.complete({ messages, max_tokens: maxTokens, temperature: 0.4, top_p: 0.9, stream: false })
    return plainAnswer(answer)
  }

  private async generate(question: string, context: string, maxTokens: number, languageLabel?: string): Promise<string> {
    const system = inLanguage(groundedInstruction(describeNow(this.now(), this.timeZone)), languageLabel)
    const answer = await this.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Private source context:\n${context}\n\nQuestion:\n${question}` },
      ],
      max_tokens: maxTokens,
      temperature: 0,
      top_k: 40,
      top_p: 0.95,
      stream: false,
    })
    return plainAnswer(answer)
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
