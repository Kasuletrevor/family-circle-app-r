import { describe, expect, it, vi } from 'vitest'
import type { AngelConnection } from '../../shared/agentic'
import { connectDoneCode, KIN_KEEPERS_API, KinKeepersConnection, pkceChallenge } from './KinKeepersConnection'

type Reply = Response | Error | Promise<Response>

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const tokenBody = (n: number, extra: Record<string, unknown> = {}) => ({
  access_token: `access-${n}`, refresh_token: `refresh-${n}`, token_type: 'bearer',
  expires_in: 900, refresh_expires_in: 604800, scope: 'angels:read angels:add angels:remove', ...extra,
})
const CODE = 'code-abcdefghijklmnop'
const VERIFIER = Buffer.alloc(32, 7).toString('base64url')

function setup(replies: Reply[]) {
  let time = 1_000_000
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: { ...(init?.headers as Record<string, string>) },
    })
    const next = replies.shift()
    if (!next) throw new Error('unexpected request')
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch
  const changes: AngelConnection[] = []
  const connection = new KinKeepersConnection({
    fetch: fetchImpl,
    onChange: (value) => changes.push(value),
    now: () => time,
    timeoutMs: 50,
    randomBytes: (size) => Buffer.alloc(size, 7),
  })
  return { connection, calls, changes, advance: (ms: number) => { time += ms } }
}

async function connected(more: Reply[] = []) {
  const state = setup([json(200, tokenBody(1, { user: { email: 'pat@example.test', name: 'Pat' } })), ...more])
  state.connection.begin()
  await expect(state.connection.complete(CODE)).resolves.toBe(true)
  return state
}

describe('KinKeepersConnection', () => {
  it('computes the S256 challenge from RFC 7636', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('builds the connect address without the verifier', () => {
    const { connection } = setup([])
    const url = new URL(connection.begin())
    expect(url.origin + url.pathname).toBe('https://kin-keepers.ai/connect')
    expect(url.searchParams.get('app')).toBe('family-circle')
    expect(url.searchParams.get('challenge')).toBe(pkceChallenge(VERIFIER))
    expect(url.searchParams.get('challenge')).toHaveLength(43)
    expect(url.href).not.toContain(VERIFIER)
    expect(connection.status()).toEqual({ status: 'connecting' })
  })

  it('exchanges the code with the verifier and reports the account', async () => {
    const { connection, calls, changes } = await connected()
    expect(calls[0]).toMatchObject({ url: `${KIN_KEEPERS_API}/api/auth/app/token`, body: { code: CODE, verifier: VERIFIER } })
    expect(connection.status()).toEqual({ status: 'connected', email: 'pat@example.test' })
    expect(changes.at(-1)).toEqual({ status: 'connected', email: 'pat@example.test' })
  })

  it('ignores a code when no connection was started', async () => {
    const { connection, calls } = setup([])
    await expect(connection.complete(CODE)).resolves.toBe(false)
    expect(calls).toHaveLength(0)
    expect(connection.status()).toEqual({ status: 'disconnected' })
  })

  it('drops the attempt after a failed exchange, a cancel or expiry', async () => {
    const failed = setup([json(400, { detail: { code: 'invalid_grant', message: 'expired' } })])
    failed.connection.begin()
    await expect(failed.connection.complete(CODE)).resolves.toBe(false)
    expect(failed.connection.status()).toEqual({ status: 'disconnected', problem: 'connect-failed' })
    await expect(failed.connection.complete(CODE)).resolves.toBe(false)
    expect(failed.calls).toHaveLength(1)

    const cancelled = setup([])
    cancelled.connection.begin()
    cancelled.connection.cancel()
    expect(cancelled.connection.status()).toEqual({ status: 'disconnected' })
    await cancelled.connection.complete(CODE)

    const expired = setup([])
    expired.connection.begin()
    expired.advance(10 * 60 * 1000 + 1)
    expect(expired.connection.status().status).toBe('disconnected')
    await expired.connection.complete(CODE)
    expect([...cancelled.calls, ...expired.calls]).toHaveLength(0)
  })

  it('revokes tokens that arrive after a disconnect', async () => {
    let deliver!: (response: Response) => void
    const { connection, calls } = setup([new Promise<Response>((resolve) => { deliver = resolve }), json(200, { message: 'Logged out successfully' })])
    connection.begin()
    const completing = connection.complete(CODE)
    await connection.disconnect()
    deliver(json(200, tokenBody(1)))
    await expect(completing).resolves.toBe(false)
    expect(connection.status()).toEqual({ status: 'disconnected' })
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]).toMatchObject({ url: `${KIN_KEEPERS_API}/api/auth/logout`, body: { refresh_token: 'refresh-1' } })
  })

  it('reads the code only from the exact connect-done page', () => {
    expect(connectDoneCode(`https://kin-keepers.ai/connect/done?code=${CODE}`)).toBe(CODE)
    for (const url of [
      `https://www.kin-keepers.ai/connect/done?code=${CODE}`,
      `http://kin-keepers.ai/connect/done?code=${CODE}`,
      `https://kin-keepers.ai/connect/done/x?code=${CODE}`,
      `https://kin-keepers.ai.evil.test/connect/done?code=${CODE}`,
      `https://user@kin-keepers.ai/connect/done?code=${CODE}`,
      'https://kin-keepers.ai/connect/done',
      'https://kin-keepers.ai/connect/done?code=short',
      'https://kin-keepers.ai/connect/done?code=abc%20defghijklmnopqrstu',
      'not a url',
    ]) {
      expect(connectDoneCode(url)).toBeNull()
    }
  })

  it('returns the current access token without refreshing', async () => {
    const { connection, calls } = await connected()
    await expect(connection.accessToken()).resolves.toBe('access-1')
    expect(calls).toHaveLength(1)
  })

  it('refreshes once for callers that arrive together near expiry', async () => {
    const { connection, calls, advance } = await connected([json(200, tokenBody(2))])
    advance(900_000 - 30_000)
    await expect(Promise.all([connection.accessToken(), connection.accessToken()])).resolves.toEqual(['access-2', 'access-2'])
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ url: `${KIN_KEEPERS_API}/api/auth/app/refresh`, body: { refresh_token: 'refresh-1' } })
    expect(connection.status()).toEqual({ status: 'connected', email: 'pat@example.test' })
  })

  it('refreshes a token the server rejected', async () => {
    const { connection } = await connected([json(200, tokenBody(2))])
    await expect(connection.accessToken({ rejected: 'access-1' })).resolves.toBe('access-2')
  })

  it('ends the connection after a refresh lost on the network, without sending the refresh token again', async () => {
    const { connection, calls, advance } = await connected([new Error('socket hang up'), json(200, { message: 'Logged out successfully' })])
    advance(900_000)
    await expect(connection.accessToken()).resolves.toBeNull()
    expect(connection.status()).toEqual({ status: 'disconnected', problem: 'ended' })
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    expect(calls.filter((call) => call.url.endsWith('/refresh'))).toHaveLength(1)
    expect(calls[2]).toMatchObject({ url: `${KIN_KEEPERS_API}/api/auth/logout`, body: { refresh_token: 'refresh-1' } })
    expect(calls[2]!.headers.authorization).toBeUndefined()
  })

  it.each(['invalid_grant', 'refresh_token_reuse'])('ends the connection when refresh says %s', async (code) => {
    const { connection, advance } = await connected([json(401, { detail: { code, message: 'no' } }), json(200, {})])
    advance(900_000)
    await expect(connection.accessToken()).resolves.toBeNull()
    expect(connection.status()).toEqual({ status: 'disconnected', problem: 'ended' })
  })

  it('forgets tokens before signing out and ignores sign-out failures', async () => {
    const { connection, calls } = await connected([new Error('offline')])
    const leaving = connection.disconnect()
    expect(connection.status()).toEqual({ status: 'disconnected' })
    await expect(connection.accessToken()).resolves.toBeNull()
    await expect(leaving).resolves.toBeUndefined()
    expect(calls[1]).toMatchObject({ url: `${KIN_KEEPERS_API}/api/auth/logout`, body: { refresh_token: 'refresh-1' } })
    expect(calls[1]!.headers.authorization).toBe('Bearer access-1')
  })

  it('disconnects when another Family Circle account signs in', async () => {
    const state = setup([json(200, tokenBody(1)), json(200, {})])
    await state.connection.useAccount('account-a')
    state.connection.begin()
    await state.connection.complete(CODE)
    await state.connection.useAccount('account-a')
    expect(state.connection.status().status).toBe('connected')
    await state.connection.useAccount('account-b')
    expect(state.connection.status()).toEqual({ status: 'disconnected' })
  })

  it('never puts secrets in the states it reports', async () => {
    const { changes, connection, advance } = await connected([json(200, tokenBody(2))])
    advance(900_000)
    await connection.accessToken()
    const reported = JSON.stringify(changes)
    for (const secret of ['access-', 'refresh-', VERIFIER, CODE]) expect(reported).not.toContain(secret)
  })
})
