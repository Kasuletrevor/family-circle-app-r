import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import { StoryMediaService } from './StoryMediaService'

function user(id = 7): AuthUser {
  return { id, email: 'user@example.com', name: 'User', accountOrigin: 'registered', mustChangePassword: false, onboardingCompleted: true }
}

function harness(paths: string[] = ['C:/picked/family.jpg']) {
  const session = { restore: vi.fn(async () => user()) }
  const picker = { chooseMedia: vi.fn(async () => paths) }
  let nextId = 1
  const rows: Array<any> = []
  const repository = {
    insertActive: vi.fn(async (input: any) => {
      const row = { id: nextId++, ...input, storageStatus: 'active', legacySourceKey: null, createdAt: 100 }
      rows.push(row)
      return row
    }),
    listByUser: vi.fn(async (localUserId: number) => rows.filter((row) => row.localUserId === localUserId && row.storageStatus === 'active')),
    getByIdForUser: vi.fn(async (localUserId: number, mediaId: number) => rows.find((row) => row.localUserId === localUserId && row.id === mediaId) ?? null),
    deleteByIdForUser: vi.fn(async (localUserId: number, mediaId: number) => {
      const index = rows.findIndex((row) => row.localUserId === localUserId && row.id === mediaId)
      if (index < 0) return false
      rows.splice(index, 1)
      return true
    }),
  }
  const fileStore = {
    validateSelected: vi.fn(async (_path: string, mediaType: string) => ({
      mediaType,
      mimeType: mediaType === 'photo' ? 'image/jpeg' : 'audio/wav',
      extension: mediaType === 'photo' ? '.jpg' : '.wav',
      sizeBytes: 123,
    })),
    copyIntoStory: vi.fn(async (_id: number, path: string, extension: string) => `story/users/7/media/copied-${path.split('/').pop()}${extension}`),
    resolveOwnedPath: vi.fn((_id: number, stored: string) => `C:/userdata/${stored}`),
    deleteOwnedFile: vi.fn(async () => undefined),
  }
  const opener = { openPath: vi.fn(async () => '') }
  return { service: new StoryMediaService({ session, picker, repository, fileStore, opener }), session, picker, repository, fileStore, opener, rows }
}

describe('StoryMediaService', () => {
  it('requires session, validates field/type, handles picker cancel, and enforces eight selected files', async () => {
    const { service, session, picker, repository } = harness([])
    session.restore.mockResolvedValueOnce(null)
    await expect(service.list()).rejects.toMatchObject({ code: 'unauthenticated' })

    await expect(service.chooseAndAdd({ fieldKey: 'bogus' as never, mediaType: 'photo' })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(service.chooseAndAdd({ fieldKey: 'childhood', mediaType: 'video' as never })).rejects.toMatchObject({ code: 'invalid-input' })

    expect(await service.chooseAndAdd({ fieldKey: 'childhood', mediaType: 'photo' })).toEqual({ canceled: true, items: [] })
    expect(repository.insertActive).not.toHaveBeenCalled()

    picker.chooseMedia.mockResolvedValueOnce(Array.from({ length: 9 }, (_, index) => `C:/picked/${index}.jpg`))
    await expect(service.chooseAndAdd({ fieldKey: 'childhood', mediaType: 'photo' })).rejects.toMatchObject({ code: 'too-many' })
  })

  it('copies before inserting an active row and exposes only safe media metadata', async () => {
    const { service, repository, fileStore } = harness()
    const order: string[] = []
    fileStore.copyIntoStory.mockImplementationOnce(async () => { order.push('copy'); return 'story/users/7/media/random.jpg' })
    repository.insertActive.mockImplementationOnce(async (input: any) => {
      order.push('insert')
      return { id: 9, ...input, storageStatus: 'active', legacySourceKey: null, createdAt: 100 }
    })

    const result = await service.chooseAndAdd({ fieldKey: 'childhood', mediaType: 'photo' })

    expect(order).toEqual(['copy', 'insert'])
    expect(result.items[0]).toEqual({ id: 9, fieldKey: 'childhood', mediaType: 'photo', fileName: 'family.jpg', mimeType: 'image/jpeg', sizeBytes: 123, createdAt: 100 })
    expect(JSON.stringify(result)).not.toContain('storedRelativePath')
    expect(JSON.stringify(result)).not.toContain('localUserId')
  })

  it('creates no active row when copy fails and cleans the copied file if row insertion fails', async () => {
    const first = harness()
    first.fileStore.copyIntoStory.mockRejectedValueOnce(new Error('C:/private/source'))
    const copyFailure = await first.service.chooseAndAdd({ fieldKey: 'childhood', mediaType: 'photo' })
    expect(copyFailure.items[0]).toMatchObject({ outcome: 'failed', fileName: 'family.jpg' })
    expect(first.repository.insertActive).not.toHaveBeenCalled()

    const second = harness()
    second.repository.insertActive.mockRejectedValueOnce(new Error('sqlite path'))
    const insertFailure = await second.service.chooseAndAdd({ fieldKey: 'childhood', mediaType: 'photo' })
    expect(insertFailure.items[0]).toMatchObject({ outcome: 'failed', fileName: 'family.jpg' })
    expect(second.fileStore.deleteOwnedFile).toHaveBeenCalledTimes(1)
  })

  it('opens and deletes only media re-resolved to the restored user', async () => {
    const { service, rows, repository, fileStore, opener } = harness()
    rows.push({ id: 4, localUserId: 7, fieldKey: 'childhood', mediaType: 'photo', fileName: 'mine.jpg', mimeType: 'image/jpeg', sizeBytes: 1, storedRelativePath: 'story/users/7/media/mine.jpg', storageStatus: 'active', legacySourceKey: null, createdAt: 1 })

    await expect(service.open({ mediaId: 999 })).rejects.toMatchObject({ code: 'not-found' })
    expect(opener.openPath).not.toHaveBeenCalled()

    await expect(service.open({ mediaId: 4 })).resolves.toEqual({ success: true })
    expect(fileStore.resolveOwnedPath).toHaveBeenCalledWith(7, 'story/users/7/media/mine.jpg')
    expect(opener.openPath).toHaveBeenCalledWith('C:/userdata/story/users/7/media/mine.jpg')

    await expect(service.delete({ mediaId: 4 })).resolves.toEqual({ success: true })
    expect(fileStore.deleteOwnedFile).toHaveBeenCalledWith(7, 'story/users/7/media/mine.jpg')
    expect(repository.deleteByIdForUser).toHaveBeenCalledWith(7, 4)
  })

  it('treats an already-missing owned file as successful cleanup', async () => {
    const { service, rows, fileStore } = harness()
    rows.push({ id: 5, localUserId: 7, fieldKey: 'childhood', mediaType: 'photo', fileName: 'gone.jpg', mimeType: 'image/jpeg', sizeBytes: 1, storedRelativePath: 'story/users/7/media/gone.jpg', storageStatus: 'active', legacySourceKey: null, createdAt: 1 })
    fileStore.deleteOwnedFile.mockResolvedValueOnce(undefined)

    await expect(service.delete({ mediaId: 5 })).resolves.toEqual({ success: true })
    await expect(service.list()).resolves.toEqual([])
  })
})
