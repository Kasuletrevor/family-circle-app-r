import { describe, expect, it, vi } from 'vitest'
import { registerCirclePhotoIpc, type CirclePhotoIpcService } from './circleIpc'

const JPEG = 'data:image/jpeg;base64,QUJD'

function register(service: Partial<CirclePhotoIpcService>) {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()
  registerCirclePhotoIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, {
    listPhotos: vi.fn(async () => ({})),
    choosePhoto: vi.fn(async () => ({ status: 'canceled' as const })),
    removePhoto: vi.fn(async () => ({ success: true as const })),
    ...service,
  })
  return (channel: string, payload?: unknown) => handlers.get(channel)!({}, payload)
}

describe('Circle photo IPC', () => {
  it('only passes on JPEG data URLs', async () => {
    const call = register({
      listPhotos: vi.fn(async () => ({
        'user:1': JPEG,
        'user:2': 'data:image/svg+xml;base64,PHN2Zz4=',
        'user:3': `${JPEG}" onerror="alert(1)`,
      })),
    })
    await expect(call('circle:photos-list')).resolves.toEqual({ 'user:1': JPEG })
  })

  it('passes the person ID through and maps choices to safe results', async () => {
    const choosePhoto = vi.fn()
      .mockResolvedValueOnce({ status: 'saved', personId: 'user:1', dataUrl: JPEG })
      .mockResolvedValueOnce({ status: 'saved', personId: 'user:1', dataUrl: 'file:///C:/secret.jpg' })
      .mockResolvedValueOnce({ status: 'too-large' })
    const removePhoto = vi.fn(async () => ({ success: true as const }))
    const call = register({ choosePhoto, removePhoto })

    await expect(call('circle:photo-choose', { personId: 'user:1' })).resolves.toEqual({ status: 'saved', personId: 'user:1', dataUrl: JPEG })
    expect(choosePhoto).toHaveBeenCalledWith('user:1')
    await expect(call('circle:photo-choose', { personId: 'user:1' })).resolves.toEqual({ status: 'unsupported' })
    await expect(call('circle:photo-choose', { personId: 'user:1' })).resolves.toEqual({ status: 'too-large' })
    await expect(call('circle:photo-remove', { personId: 'user:1' })).resolves.toEqual({ success: true })
    expect(removePhoto).toHaveBeenCalledWith('user:1')
  })
})
