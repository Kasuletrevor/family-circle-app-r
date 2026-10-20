import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto'
import type { AngelConnection } from '../../shared/agentic'
import { limitedRequest } from './limitedRequest'

export const KIN_KEEPERS_SITE = 'https://kin-keepers.ai'
export const KIN_KEEPERS_API = 'https://agentback.kin-keepers.ai'
const ATTEMPT_LIFETIME_MS = 10 * 60 * 1000
const REFRESH_MARGIN_MS = 60 * 1000
const MAX_RESPONSE_BYTES = 64 * 1024
const LOGOUT_TIMEOUT_MS = 5_000
const CODE = /^[A-Za-z0-9_-]{16,512}$/
const TOKEN = /^[A-Za-z0-9._~+/=-]{1,8192}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/

/** BASE64URL(SHA256(verifier)) without padding (PKCE S256). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

/** The code from exactly `https://kin-keepers.ai/connect/done?code=…`, or null for any other address. */
export function connectDoneCode(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.origin !== KIN_KEEPERS_SITE || parsed.pathname !== '/connect/done' || parsed.username || parsed.password) return null
  const code = parsed.searchParams.get('code')
  return code && CODE.test(code) ? code : null
}

interface Tokens { access: string; accessExpiresAt: number; refresh: string; email: string | null }

export interface KinKeepersConnectionDeps {
  fetch: typeof fetch
  onChange(connection: AngelConnection): void
  now?: () => number
  timeoutMs?: number
  randomBytes?: (size: number) => Buffer
}

/**
 * The Kin-Keepers.ai connection for the signed-in Family Circle account, made with PKCE.
 * App tokens live in memory only and never leave the main process.
 */
export class KinKeepersConnection {
  private tokens: Tokens | null = null
  private attempt: { verifier: string; expiresAt: number } | null = null
  private refreshing: Promise<string | null> | null = null
  /** Token exchanges still waiting for the server; a count, so an older one finishing never hides a newer one. */
  private exchanges = 0
  private problem: 'connect-failed' | 'ended' | undefined
  private account: string | null = null
  /** Bumped whenever the connection is dropped, so late responses from an old session are ignored. */
  private generation = 0
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly randomBytes: (size: number) => Buffer

  constructor(private readonly deps: KinKeepersConnectionDeps) {
    this.now = deps.now ?? Date.now
    this.timeoutMs = deps.timeoutMs ?? 10_000
    this.randomBytes = deps.randomBytes ?? nodeRandomBytes
  }

  status(): AngelConnection {
    if (this.tokens) return { status: 'connected', email: this.tokens.email }
    if (this.attempt && this.attempt.expiresAt > this.now()) return { status: 'connecting' }
    return this.problem ? { status: 'disconnected', problem: this.problem } : { status: 'disconnected' }
  }

  /** Ties the connection to one Family Circle account; a different account starts disconnected. */
  async useAccount(account: string | null): Promise<void> {
    if (account === this.account) return
    this.account = account
    await this.disconnect()
  }

  /** Starts a connection and returns the kin-keepers.ai page that finishes it. */
  begin(): string {
    const verifier = this.randomBytes(32).toString('base64url')
    this.attempt = { verifier, expiresAt: this.now() + ATTEMPT_LIFETIME_MS }
    this.problem = undefined
    this.changed()
    const query = new URLSearchParams({ app: 'family-circle', challenge: pkceChallenge(verifier) })
    return `${KIN_KEEPERS_SITE}/connect?${query}`
  }

  cancel(): void {
    if (!this.attempt && this.exchanges === 0) return
    this.attempt = null
    // An exchange already under way must not connect after Cancel; its tokens are revoked.
    if (this.exchanges > 0) this.generation += 1
    this.changed()
  }

  /** Exchanges the code from `/connect/done`; a code without a pending attempt is ignored. */
  async complete(code: string): Promise<boolean> {
    const attempt = this.attempt
    this.attempt = null
    if (!attempt) return false
    if (attempt.expiresAt <= this.now() || !CODE.test(code)) return this.failConnect()
    const generation = this.generation
    this.exchanges += 1
    const tokens = await this.requestTokens('/api/auth/app/token', { code, verifier: attempt.verifier })
      .catch(() => null)
      .finally(() => { this.exchanges -= 1 })
    if (generation !== this.generation) {
      // Cancelled or disconnected while the exchange was running: the new session must not outlive it.
      if (tokens) void this.logout(tokens)
      return false
    }
    if (!tokens) return this.failConnect()
    this.tokens = tokens
    this.problem = undefined
    this.changed()
    return true
  }

  /** A valid access token, refreshed first when close to expiry or rejected by the server. */
  async accessToken(options: { rejected?: string } = {}): Promise<string | null> {
    const tokens = this.tokens
    if (!tokens) return null
    const stale = tokens.access === options.rejected || tokens.accessExpiresAt - REFRESH_MARGIN_MS <= this.now()
    if (!stale) return tokens.access
    // One refresh at a time: a refresh token works once, and sending it twice ends the session.
    if (!this.refreshing) {
      const refreshing: Promise<string | null> = this.refresh(tokens).finally(() => {
        // A refresh from an earlier session must not clear the current session's refresh.
        if (this.refreshing === refreshing) this.refreshing = null
      })
      this.refreshing = refreshing
    }
    return this.refreshing
  }

  /** Forgets the connection at once, then signs the app session out as a best effort. */
  async disconnect(problem?: 'ended'): Promise<void> {
    const tokens = this.tokens
    this.tokens = null
    this.attempt = null
    this.refreshing = null
    this.generation += 1
    this.problem = problem
    this.changed()
    if (tokens) await this.logout(tokens)
  }

  private failConnect(): false {
    this.problem = 'connect-failed'
    this.changed()
    return false
  }

  private async refresh(current: Tokens): Promise<string | null> {
    const generation = this.generation
    // A network failure leaves the outcome unknown, so the refresh token is never sent again.
    const next = await this.requestTokens('/api/auth/app/refresh', { refresh_token: current.refresh }).catch(() => null)
    if (generation !== this.generation) return null
    if (!next) {
      // Sign-out accepts a used refresh token too, so this also revokes a session the server did rotate.
      await this.disconnect('ended')
      return null
    }
    this.tokens = { ...next, email: next.email ?? current.email }
    return this.tokens.access
  }

  private async requestTokens(path: string, body: Record<string, string>): Promise<Tokens | null> {
    const response = await limitedRequest(this.deps.fetch, `${KIN_KEEPERS_API}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    }, { maxBytes: MAX_RESPONSE_BYTES, timeoutMs: this.timeoutMs })
    return response.status === 200 ? this.parseTokens(response.bytes) : null
  }

  private parseTokens(bytes: Buffer): Tokens | null {
    let raw: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(bytes.toString('utf8'))
      if (parsed == null || typeof parsed !== 'object') return null
      raw = parsed as Record<string, unknown>
    } catch {
      return null
    }
    const { access_token: access, refresh_token: refresh, expires_in: expiresIn } = raw
    if (typeof access !== 'string' || !TOKEN.test(access) || typeof refresh !== 'string' || !TOKEN.test(refresh)) return null
    const lifetime = typeof expiresIn === 'number' && expiresIn > 0 && expiresIn <= 86_400 ? expiresIn : 900
    const user = raw.user != null && typeof raw.user === 'object' ? raw.user as Record<string, unknown> : {}
    // The backend may send the account as `account_email` (or as `user.email`), or not at all.
    const email = typeof raw.account_email === 'string' ? raw.account_email : user.email
    return {
      access,
      refresh,
      accessExpiresAt: this.now() + lifetime * 1000,
      email: typeof email === 'string' && EMAIL.test(email) ? email : null,
    }
  }

  private async logout(tokens: Tokens): Promise<void> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (tokens.accessExpiresAt > this.now()) headers.authorization = `Bearer ${tokens.access}`
    await limitedRequest(this.deps.fetch, `${KIN_KEEPERS_API}/api/auth/logout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ refresh_token: tokens.refresh }),
    }, { maxBytes: MAX_RESPONSE_BYTES, timeoutMs: LOGOUT_TIMEOUT_MS }).catch(() => undefined)
  }

  private changed(): void {
    this.deps.onChange(this.status())
  }
}
