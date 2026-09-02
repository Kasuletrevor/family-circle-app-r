import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './createDesktopApi'

describe('createDesktopApi', () => {
  it('exposes only approved application metadata calls', async () => {
    const invoke = vi.fn(async (channel: string) => channel === 'app:get-version' ? '0.1.0' : 'win32')
    const api = createDesktopApi(invoke)

    expect(Object.keys(api)).toEqual(['app'])
    expect(Object.keys(api.app)).toEqual(['getVersion', 'getPlatform'])
    expect(JSON.stringify(api).toLowerCase()).not.toContain('api_key')

    await expect(api.app.getVersion()).resolves.toBe('0.1.0')
    await expect(api.app.getPlatform()).resolves.toBe('win32')
  })
})
