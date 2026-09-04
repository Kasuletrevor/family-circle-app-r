import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './createDesktopApi'

describe('createDesktopApi Private AI contract', () => {
  it('exposes only safe setup status/actions and strips internal fields', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'private-ai:get-status') {
        return {
          state: 'repair_required',
          ready: false,
          repairRequired: true,
          totalSizeBytes: 2_000_000_000,
          version: '2026.09.04',
          message: 'Private AI needs repair',
          url: 'https://secret.example/model.gguf',
          targetPath: 'C:/private/offline-ai',
          sha256: 'SECRET',
          model: 'granite-secret.gguf',
          pid: 1234,
          port: 8188,
        }
      }
      return { state: 'ready', ready: true, repairRequired: false, totalSizeBytes: 2_000_000_000, version: '2026.09.04', message: 'Private AI is ready' }
    })
    const api = createDesktopApi(invoke)
    const privateAi = (api as unknown as { privateAi: {
      getStatus(): Promise<unknown>
      startSetup(): Promise<unknown>
      pauseSetup(): Promise<unknown>
      repair(): Promise<unknown>
    } }).privateAi

    expect(Object.keys(privateAi)).toEqual(['getStatus', 'startSetup', 'pauseSetup', 'repair', 'onProgress'])
    const status = await privateAi.getStatus()
    expect(status).toEqual({
      state: 'repair_required',
      ready: false,
      repairRequired: true,
      totalSizeBytes: 2_000_000_000,
      version: '2026.09.04',
      message: 'Private AI needs repair',
    })
    expect(JSON.stringify(status)).not.toMatch(/url|path|sha|model|pid|port/i)

    await privateAi.startSetup()
    await privateAi.pauseSetup()
    await privateAi.repair()
    expect(invoke).toHaveBeenCalledWith('private-ai:start-setup')
    expect(invoke).toHaveBeenCalledWith('private-ai:pause-setup')
    expect(invoke).toHaveBeenCalledWith('private-ai:repair')
  })

  it('sanitizes Private AI progress and preserves listener unsubscribe semantics', () => {
    let bridgeListener: ((payload: unknown) => void) | null = null
    const unsubscribe = vi.fn()
    const subscribe = vi.fn((_channel: string, listener: (payload: unknown) => void) => {
      bridgeListener = listener
      return unsubscribe
    })
    const api = createDesktopApi(vi.fn(async () => undefined), subscribe as never)
    const listener = vi.fn()
    const privateAi = (api as unknown as { privateAi: { onProgress(listener: (value: unknown) => void): () => void } }).privateAi

    const returned = privateAi.onProgress(listener)
    expect(returned).toBe(unsubscribe)
    expect(subscribe).toHaveBeenCalledWith('private-ai:progress', expect.any(Function))

    ;(bridgeListener as ((payload: unknown) => void) | null)?.({
      state: 'downloading',
      percent: 42,
      fileIndex: 2,
      fileCount: 3,
      fileName: 'Private AI component 2 of 3',
      bytesDownloaded: 420,
      totalSizeBytes: 1000,
      fileBytesDownloaded: 120,
      fileSizeBytes: 300,
      message: 'Downloading Private AI',
      url: 'https://secret.example/model',
      targetPath: 'C:/secret',
      sha256: 'SECRET',
      modelPath: 'C:/secret/model.gguf',
      pid: 99,
      port: 8080,
    })

    expect(listener).toHaveBeenCalledWith({
      state: 'downloading',
      percent: 42,
      fileIndex: 2,
      fileCount: 3,
      fileName: 'Private AI component 2 of 3',
      bytesDownloaded: 420,
      totalSizeBytes: 1000,
      fileBytesDownloaded: 120,
      fileSizeBytes: 300,
      message: 'Downloading Private AI',
    })
    expect(JSON.stringify(listener.mock.calls[0]?.[0])).not.toMatch(/url|path|sha|model|pid|port/i)
  })
})
