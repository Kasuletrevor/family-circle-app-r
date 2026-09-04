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
    }

    registerPrivateAiIpc(ipc as never, service as never)

    expect([...handlers.keys()]).toEqual([
      'private-ai:get-status',
      'private-ai:start-setup',
      'private-ai:pause-setup',
      'private-ai:repair',
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

    expect(service.getStatus).toHaveBeenCalledWith()
    expect(service.startSetup).toHaveBeenCalledWith(expect.any(Function))
    expect(service.pauseSetup).toHaveBeenCalledWith()
    expect(service.repair).toHaveBeenCalledWith(expect.any(Function))
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
})
