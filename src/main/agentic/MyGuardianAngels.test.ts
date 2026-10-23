import { describe, expect, it, vi } from 'vitest'
import type { GuardianAngelTemplate } from '../../shared/agentic'
import { KIN_KEEPERS_API } from './KinKeepersConnection'
import { MyGuardianAngels } from './MyGuardianAngels'

const template: GuardianAngelTemplate = {
  id: '7', name: 'Elder Companion', description: '', category: 'elder_companion',
  trustBoundaries: [], escalationTriggers: [], avatar: null,
}
const agent = (id: number, extra: Record<string, unknown> = {}) => ({
  id, name: `Angel ${id}`, description: 'Helps', model: 'gpt-4o-mini', original_agent_id: 7, run_count: 0,
  trust_boundaries: [], escalation_triggers: [], created_by: 'owner@example.test', ...extra,
})
const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status })

function setup(replies: Array<Response | Error>, token: string | null = 'token-1') {
  const fetchImpl = vi.fn(async () => {
    const next = replies.shift()
    if (!next) throw new Error('unexpected request')
    if (next instanceof Error) throw next
    return next
  })
  const connection = {
    accessToken: vi.fn(async (options?: { rejected?: string }) => (options?.rejected ? 'token-2' : token)),
    disconnect: vi.fn(async () => undefined),
  }
  const angels = new MyGuardianAngels({
    fetch: fetchImpl as unknown as typeof fetch,
    connection,
    templates: async () => [template],
    timeoutMs: 50,
  })
  const call = (index: number) => fetchImpl.mock.calls[index] as unknown as [string, RequestInit]
  return { angels, fetchImpl, connection, call }
}

describe('MyGuardianAngels', () => {
  it('lists angels with the app token in the safe shape', async () => {
    const { angels, call } = setup([json(200, [agent(5)])])
    const result = await angels.list()
    expect(result).toEqual({ status: 'ready', angels: [expect.objectContaining({ id: '5', templateName: 'Elder Companion' })] })
    expect(call(0)[0]).toBe(`${KIN_KEEPERS_API}/api/agno/agents`)
    expect(call(0)[1]).toMatchObject({ method: 'GET', headers: { authorization: 'Bearer token-1' }, credentials: 'omit', redirect: 'error' })
    expect(JSON.stringify(result)).not.toContain('owner@example.test')
  })

  it('reports disconnected without a request when there is no connection', async () => {
    const { angels, fetchImpl } = setup([], null)
    await expect(angels.list()).resolves.toEqual({ status: 'disconnected' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refreshes a rejected token once and retries', async () => {
    const { angels, call, connection } = setup([json(401, { detail: { code: 'invalid_token' } }), json(200, [])])
    await expect(angels.list()).resolves.toEqual({ status: 'ready', angels: [] })
    expect(connection.accessToken).toHaveBeenLastCalledWith({ rejected: 'token-1' })
    expect(call(1)[1]).toMatchObject({ headers: { authorization: 'Bearer token-2' } })
  })

  it('ends the connection when the retry is rejected too', async () => {
    const { angels, connection } = setup([json(401), json(401)])
    await expect(angels.list()).resolves.toEqual({ status: 'disconnected' })
    expect(connection.disconnect).toHaveBeenCalledWith('ended')
  })

  it('reports unavailable for network failures, server errors and bad responses', async () => {
    for (const reply of [new Error('offline'), json(500), new Response('not json'), json(200, { agents: [] })]) {
      await expect(setup([reply]).angels.list()).resolves.toEqual({ status: 'unavailable' })
    }
  })

  it('adds a template by cloning it', async () => {
    const { angels, call } = setup([json(200, { message: 'Agent cloned successfully', cloned_agent: agent(8) })])
    await expect(angels.add('7')).resolves.toEqual({ status: 'added', angel: expect.objectContaining({ id: '8', templateId: '7' }) })
    expect(call(0)[0]).toBe(`${KIN_KEEPERS_API}/api/agno/agents/7/clone`)
    expect(call(0)[1]).toMatchObject({ method: 'POST' })
  })

  it('reports a missing or private template as not found, and checks ids first', async () => {
    await expect(setup([json(404)]).angels.add('7')).resolves.toEqual({ status: 'not-found' })
    await expect(setup([json(403)]).angels.add('7')).resolves.toEqual({ status: 'not-found' })
    const { angels, fetchImpl } = setup([])
    await expect(angels.add('7/../1')).resolves.toEqual({ status: 'not-found' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('removes an angel, treating one already gone as removed', async () => {
    const removed = setup([json(204)])
    await expect(removed.angels.remove('5')).resolves.toEqual({ status: 'removed' })
    expect(removed.call(0)[0]).toBe(`${KIN_KEEPERS_API}/api/agno/agents/5`)
    expect(removed.call(0)[1]).toMatchObject({ method: 'DELETE' })
    await expect(setup([json(404)]).angels.remove('5')).resolves.toEqual({ status: 'removed' })
    await expect(setup([json(403)]).angels.remove('5')).resolves.toEqual({ status: 'not-yours' })
    await expect(setup([json(500)]).angels.remove('5')).resolves.toEqual({ status: 'unavailable' })
    const { angels, fetchImpl } = setup([])
    await expect(angels.remove('1/../2')).resolves.toEqual({ status: 'not-yours' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('MyGuardianAngels.recipe', () => {
  it('exports the angel with the app token', async () => {
    const { angels, call } = setup([json(200, { agent: { name: 'Angel 5' }, config: { instructions: 'Hi', tools: [] }, safety: {} })])
    await expect(angels.recipe('5')).resolves.toMatchObject({ status: 'ready', recipe: { angelId: '5', name: 'Angel 5', instructions: 'Hi' } })
    expect(call(0)[0]).toBe(`${KIN_KEEPERS_API}/api/agno/agents/5/export`)
    expect(call(0)[1].headers).toMatchObject({ authorization: 'Bearer token-1' })
  })

  it('maps 403 and 404 to not-yours and a bad id to not-yours without a request', async () => {
    const { angels, fetchImpl } = setup([json(403), json(404)])
    await expect(angels.recipe('5')).resolves.toEqual({ status: 'not-yours' })
    await expect(angels.recipe('5')).resolves.toEqual({ status: 'not-yours' })
    await expect(angels.recipe('../x')).resolves.toEqual({ status: 'not-yours' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('is unavailable for a broken package and disconnected without a token', async () => {
    await expect(setup([json(200, { agent: {} })]).angels.recipe('5')).resolves.toEqual({ status: 'unavailable' })
    await expect(setup([], null).angels.recipe('5')).resolves.toEqual({ status: 'disconnected' })
  })
})
