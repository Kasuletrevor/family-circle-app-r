import { describe, expect, it, vi } from 'vitest'
import { registerPrivateAiIpc } from './privateAiIpc'

function internalStatus(state: string = 'not_installed') {
  return {
    state,
    phase: state === 'ready' ? 'ready' : 'idle',
    percent: state === 'ready' ? 100 : 0,
    fileIndex: 0,
    fileCount: 3,
    fileName: 'granite-secret.gguf',
    bytesDownloaded: 0,
    totalBytes: 2_000_000_000,
    fileBytesDownloaded: 0,
    fileSizeBytes: 0,
    message: state === 'ready' ? 'Private AI is ready' : 'Private AI is optional',
    url: 'https://secret.example/model',
    targetPath: 'C:/secret',
    sha256: 'SECRET',
    modelPath: 'C:/secret/model.gguf',
    pid: 42,
    port: 8080,
  }
}

describe('registerPrivateAiIpc', () => {
  it('registers the four safe setup channels and never accepts renderer asset/runtime configuration', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
    }
    const service = {
      getStatus: vi.fn(async () => internalStatus()),
      getVersion: vi.fn(async () => '2026.09.04'),
      startSetup: vi.fn(async () => internalStatus('ready')),
      pauseSetup: vi.fn(() => internalStatus('paused')),
      repair: vi.fn(async () => internalStatus('ready')),
      remove: vi.fn(async () => internalStatus('not_installed')),
    }

    registerPrivateAiIpc(ipc as never, service as never)

    expect([...handlers.keys()]).toEqual([
      'private-ai:get-status',
      'private-ai:start-setup',
      'private-ai:pause-setup',
      'private-ai:repair',
      'private-ai:remove',
    ])

    const malicious = {
      url: 'https://attacker.example/model',
      path: 'C:/attacker',
      targetPath: 'C:/attacker',
      sha256: 'ATTACKER',
      model: 'attacker.gguf',
      pid: 999,
      port: 9999,
      localUserId: 999,
    }

    await handlers.get('private-ai:get-status')?.({}, malicious)
    await handlers.get('private-ai:start-setup')?.({}, malicious)
    await handlers.get('private-ai:pause-setup')?.({}, malicious)
    await handlers.get('private-ai:repair')?.({}, malicious)
    await handlers.get('private-ai:remove')?.({}, malicious)

    expect(service.getStatus).toHaveBeenCalledWith()
    expect(service.startSetup).toHaveBeenCalledWith(expect.any(Function))
    expect(service.pauseSetup).toHaveBeenCalledWith()
    expect(service.repair).toHaveBeenCalledWith(expect.any(Function))
    expect(service.remove).toHaveBeenCalledWith()
  })

  it('returns and emits only safe public status/progress fields', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    }
    const service = {
      getStatus: vi.fn(async () => internalStatus('repair_required')),
      getVersion: vi.fn(async () => '2026.09.04'),
      startSetup: vi.fn(async (onProgress?: (value: unknown) => void) => {
        onProgress?.({
          ...internalStatus('downloading'),
          phase: 'downloading',
          percent: 25,
          fileIndex: 2,
          fileCount: 3,
          bytesDownloaded: 500,
          totalBytes: 2000,
          fileBytesDownloaded: 200,
          fileSizeBytes: 700,
          message: 'Downloading Private AI',
        })
        return internalStatus('ready')
      }),
      pauseSetup: vi.fn(() => internalStatus('paused')),
      repair: vi.fn(async () => internalStatus('ready')),
      remove: vi.fn(async () => internalStatus('not_installed')),
    }
    registerPrivateAiIpc(ipc as never, service as never)

    const status = await handlers.get('private-ai:get-status')?.({})
    expect(status).toEqual({
      state: 'repair_required',
      ready: false,
      repairRequired: true,
      totalSizeBytes: 2_000_000_000,
      version: '2026.09.04',
      message: 'Private AI is optional',
    })
    expect(JSON.stringify(status)).not.toMatch(/url|path|sha|model|pid|port|phase|fileName/i)

    const send = vi.fn()
    const result = await handlers.get('private-ai:start-setup')?.({ sender: { send } })
    expect(send).toHaveBeenCalledWith('private-ai:progress', {
      state: 'downloading',
      percent: 25,
      fileIndex: 2,
      fileCount: 3,
      fileName: 'Private AI component 2 of 3',
      bytesDownloaded: 500,
      totalSizeBytes: 2000,
      fileBytesDownloaded: 200,
      fileSizeBytes: 700,
      message: 'Downloading Private AI',
    })
    expect(JSON.stringify(send.mock.calls[0]?.[1])).not.toMatch(/url|path|sha|model|pid|port/i)
    expect(result).toEqual({
      state: 'ready',
      ready: true,
      repairRequired: false,
      totalSizeBytes: 2_000_000_000,
      version: '2026.09.04',
      message: 'Private AI is ready',
    })
  })

  it('stops managed runtimes before removing Private AI assets', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    }
    const service = {
      getStatus: vi.fn(async () => internalStatus('ready')),
      getVersion: vi.fn(async () => '2026.09.04'),
      startSetup: vi.fn(async () => internalStatus('ready')),
      pauseSetup: vi.fn(() => internalStatus('paused')),
      repair: vi.fn(async () => internalStatus('ready')),
      remove: vi.fn(async () => internalStatus('not_installed')),
    }
    const beforeRemove = vi.fn()
    registerPrivateAiIpc(ipc as never, service as never, undefined, beforeRemove)

    const result = await handlers.get('private-ai:remove')?.({})

    expect(beforeRemove).toHaveBeenCalledTimes(1)
    expect(service.remove).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ state: 'not_installed', ready: false })
  })

  it('throttles bursty downloading progress while forwarding state transitions immediately', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    }
    let now = 1_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const progress = (state: string, bytesDownloaded: number) => ({
      ...internalStatus(state),
      state,
      phase: state === 'downloading' ? 'downloading' : 'verifying',
      percent: bytesDownloaded,
      fileIndex: 2,
      fileCount: 3,
      bytesDownloaded,
      totalBytes: 1_000,
      fileBytesDownloaded: bytesDownloaded,
      fileSizeBytes: 1_000,
      message: state === 'downloading' ? 'Downloading Private AI' : 'Verifying Private AI',
    })
    const service = {
      getStatus: vi.fn(async () => internalStatus('downloading')),
      getVersion: vi.fn(async () => '1.2.0'),
      startSetup: vi.fn(async (onProgress?: (value: unknown) => void) => {
        onProgress?.(progress('downloading', 100))
        now += 10
        onProgress?.(progress('downloading', 200))
        now += 10
        onProgress?.(progress('downloading', 300))
        now += 10
        onProgress?.(progress('verifying', 1_000))
        return internalStatus('ready')
      }),
      pauseSetup: vi.fn(() => internalStatus('paused')),
      repair: vi.fn(async () => internalStatus('ready')),
      remove: vi.fn(async () => internalStatus('not_installed')),
    }
    registerPrivateAiIpc(ipc as never, service as never)

    const send = vi.fn()
    await handlers.get('private-ai:start-setup')?.({ sender: { send } })

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0]?.[1]).toMatchObject({ state: 'downloading', bytesDownloaded: 100 })
    expect(send.mock.calls[1]?.[1]).toMatchObject({ state: 'verifying', bytesDownloaded: 1_000 })
    nowSpy.mockRestore()
  })
})
