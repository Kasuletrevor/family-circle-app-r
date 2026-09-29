import { describe, expect, it, vi } from 'vitest'
import { registerSettingsIpc } from './settingsIpc'

describe('registerSettingsIpc', () => {
  it('registers only the protected Settings channels', async () => {
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
      openDataFolder: vi.fn(async () => ({ success: true as const })),
    }

    registerSettingsIpc(ipc, service)

    expect([...handlers.keys()]).toEqual(['settings:create-backup', 'settings:open-data-folder'])
    await expect(handlers.get('settings:create-backup')?.({ sender: { id: 99 } })).resolves.toMatchObject({
      canceled: false,
      folderName: 'Family Circle Backup 2026-09-25T10-00-00-000Z',
    })
    expect(service.createBackup).toHaveBeenCalledTimes(1)

    await expect(handlers.get('settings:open-data-folder')?.({ sender: { id: 99 } }, 'C:/Windows')).resolves.toEqual({ success: true })
    expect(service.openDataFolder).toHaveBeenCalledWith()
  })
})
