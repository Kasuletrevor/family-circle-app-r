import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './createDesktopApi'

const JPEG = 'data:image/jpeg;base64,QUJD'

describe('desktop Circle photo API', () => {
  it('keeps only JPEG data URLs and sends only the person ID', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'circle:photos-list') return { 'user:1': JPEG, 'user:2': 'data:image/svg+xml;base64,PHN2Zz4=', 'user:3': 42 }
      if (channel === 'circle:photo-choose') return { status: 'saved', personId: 'user:1', dataUrl: JPEG, path: 'C:/x.jpg' }
      return { success: true }
    })
    const api = createDesktopApi(invoke)

    await expect(api.circle.listPhotos()).resolves.toEqual({ 'user:1': JPEG })
    await expect(api.circle.choosePhoto({ personId: 'user:1' })).resolves.toEqual({ status: 'saved', personId: 'user:1', dataUrl: JPEG })
    expect(invoke).toHaveBeenLastCalledWith('circle:photo-choose', { personId: 'user:1' })
    await expect(api.circle.removePhoto({ personId: 'user:1' })).resolves.toEqual({ success: true })
  })

  it('treats anything unexpected from a choice as unsupported', async () => {
    const api = createDesktopApi(vi.fn(async () => ({ status: 'saved', dataUrl: 'javascript:alert(1)' })))
    await expect(api.circle.choosePhoto({ personId: 'user:1' })).resolves.toEqual({ status: 'unsupported' })
  })
})
