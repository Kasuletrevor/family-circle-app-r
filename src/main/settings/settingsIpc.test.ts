import { describe, expect, it, vi } from 'vitest'
import { registerSettingsIpc } from './settingsIpc'

describe('registerSettingsIpc', () => {
  it('registers only the protected local-backup channel', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
    }
    const service = {
      createBackup: vi.fn(async () => ({
        canceled: false,
        folderName: 'Family Circle Backup 2026-09-25T10-00-00-000Z',
        createdAt: 123,
      })),
    }

    registerSettingsIpc(ipc, service)

    expect([...handlers.keys()]).toEqual(['settings:create-backup'])
    await expect(handlers.get('settings:create-backup')?.({ sender: { id: 99 } })).resolves.toMatchObject({
      canceled: false,
      folderName: 'Family Circle Backup 2026-09-25T10-00-00-000Z',
    })
    expect(service.createBackup).toHaveBeenCalledTimes(1)
  })
})
