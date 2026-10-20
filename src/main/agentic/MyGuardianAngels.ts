import {
  TEMPLATE_ID,
  type AddAngelResult,
  type GuardianAngelTemplate,
  type MyAngelsResult,
  type RemoveAngelResult,
} from '../../shared/agentic'
import { sanitizeAngel, sanitizeAngels } from './angelSanitizer'
import { KIN_KEEPERS_API, type KinKeepersConnection } from './KinKeepersConnection'
import { limitedRequest, type LimitedResponse } from './limitedRequest'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

export interface MyGuardianAngelsDeps {
  fetch: typeof fetch
  connection: Pick<KinKeepersConnection, 'accessToken' | 'disconnect'>
  /** Templates already downloaded for the catalog, for avatars and names. */
  templates(): Promise<GuardianAngelTemplate[]>
  timeoutMs?: number
}

type Outcome = { kind: 'response'; response: LimitedResponse } | { kind: 'disconnected' } | { kind: 'unavailable' }

function parse(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    return null
  }
}

/** The person's own Guardian Angels on Kin-Keepers.ai. The server only ever shows an app token its owner's angels. */
export class MyGuardianAngels {
  constructor(private readonly deps: MyGuardianAngelsDeps) {}

  async list(): Promise<MyAngelsResult> {
    const outcome = await this.request('GET', '/api/agno/agents')
    if (outcome.kind !== 'response') return { status: outcome.kind }
    if (outcome.response.status !== 200) return { status: 'unavailable' }
    const angels = sanitizeAngels(parse(outcome.response.bytes), await this.templateMap())
    return angels ? { status: 'ready', angels } : { status: 'unavailable' }
  }

  async add(templateId: string): Promise<AddAngelResult> {
    if (!TEMPLATE_ID.test(templateId)) return { status: 'not-found' }
    const outcome = await this.request('POST', `/api/agno/agents/${templateId}/clone`)
    if (outcome.kind !== 'response') return { status: outcome.kind }
    const { status, bytes } = outcome.response
    // 403 means the template is no longer public.
    if (status === 404 || status === 403) return { status: 'not-found' }
    if (status !== 200 && status !== 201) return { status: 'unavailable' }
    const body = parse(bytes)
    const cloned = body != null && typeof body === 'object' ? (body as Record<string, unknown>).cloned_agent : null
    const angel = sanitizeAngel(cloned, await this.templateMap())
    return angel ? { status: 'added', angel } : { status: 'unavailable' }
  }

  async remove(angelId: string): Promise<RemoveAngelResult> {
    if (!TEMPLATE_ID.test(angelId)) return { status: 'not-yours' }
    const outcome = await this.request('DELETE', `/api/agno/agents/${angelId}`)
    if (outcome.kind !== 'response') return { status: outcome.kind }
    const { status } = outcome.response
    if (status === 404 || (status >= 200 && status < 300)) return { status: 'removed' }
    if (status === 403) return { status: 'not-yours' }
    return { status: 'unavailable' }
  }

  /** Sends a request with the app token; a rejected token is refreshed once and the request retried. */
  private async request(method: string, path: string): Promise<Outcome> {
    const first = await this.deps.connection.accessToken()
    if (!first) return { kind: 'disconnected' }
    const once = await this.send(method, path, first)
    if (once.kind !== 'response' || once.response.status !== 401) return once
    const second = await this.deps.connection.accessToken({ rejected: first })
    if (!second) return { kind: 'disconnected' }
    const twice = await this.send(method, path, second)
    if (twice.kind === 'response' && twice.response.status === 401) {
      await this.deps.connection.disconnect('ended')
      return { kind: 'disconnected' }
    }
    return twice
  }

  private async send(method: string, path: string, token: string): Promise<Outcome> {
    try {
      const response = await limitedRequest(this.deps.fetch, `${KIN_KEEPERS_API}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      }, { maxBytes: MAX_RESPONSE_BYTES, timeoutMs: this.deps.timeoutMs ?? 10_000 })
      return { kind: 'response', response }
    } catch {
      return { kind: 'unavailable' }
    }
  }

  private async templateMap(): Promise<Map<string, GuardianAngelTemplate>> {
    try {
      return new Map((await this.deps.templates()).map((template) => [template.id, template]))
    } catch {
      return new Map()
    }
  }
}
