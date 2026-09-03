import { describe, expect, it, vi } from 'vitest'
import { registerCircleIpc } from './circleIpc'

describe('registerCircleIpc', () => {
  it('registers one read-only overview handler and delegates without renderer-supplied identity', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
    }
    const overview = {
      status: 'empty' as const,
      reason: 'no-circles' as const,
      circles: [],
      activeCircleId: null,
      tree: null,
      notifications: [],
    }
    const service = { getOverview: vi.fn(async () => overview) }

    registerCircleIpc(ipc, service)

    expect([...handlers.keys()]).toEqual(['circle:get-overview'])
    await expect(handlers.get('circle:get-overview')?.({ sender: 'ignored' }, 'malicious-user-id')).resolves.toEqual(overview)
    expect(service.getOverview).toHaveBeenCalledTimes(1)
    expect(service.getOverview).toHaveBeenCalledWith()
  })
})
