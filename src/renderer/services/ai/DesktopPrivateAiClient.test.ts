import { describe, expect, it, vi } from 'vitest'
import { DesktopPrivateAiClient } from './DesktopPrivateAiClient'

describe('DesktopPrivateAiClient', () => {
  it('delegates only the approved safe Private AI desktop operations', async () => {
    const status = {
      state: 'not_installed' as const,
      ready: false,
      repairRequired: false,
      totalSizeBytes: 2_000_000_000,
      version: '2026.09.04',
      message: 'Private AI is optional',
    }
    const unsubscribe = vi.fn()
    const operations = {
      getStatus: vi.fn(async () => status),
      startSetup: vi.fn(async () => ({ ...status, state: 'downloading' as const })),
      pauseSetup: vi.fn(async () => ({ ...status, state: 'paused' as const })),
      repair: vi.fn(async () => ({ ...status, state: 'ready' as const, ready: true })),
      onProgress: vi.fn(() => unsubscribe),
    }
    const client = new DesktopPrivateAiClient(operations as never)

    await expect(client.getStatus()).resolves.toEqual(status)
    await client.startSetup()
    await client.pauseSetup()
    await client.repair()
    const listener = vi.fn()
    expect(client.onProgress(listener)).toBe(unsubscribe)
    expect(operations.onProgress).toHaveBeenCalledWith(listener)
  })
})
