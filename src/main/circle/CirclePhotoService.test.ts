import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CirclePhotoService, MAX_PHOTO_SOURCE_BYTES, type PhotoImage } from './CirclePhotoService'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'family-circle-photos-'))
  roots.push(root)
  return root
}

function fakeImage(width: number, height: number, log: string[] = []): PhotoImage {
  const image: PhotoImage = {
    isEmpty: () => width === 0,
    getSize: () => ({ width, height }),
    crop: (rect) => { log.push(`crop ${rect.x},${rect.y} ${rect.width}x${rect.height}`); return image },
    resize: (size) => { log.push(`resize ${size.width}x${size.height}`); return image },
    toJPEG: (quality) => { log.push(`jpeg ${quality}`); return Buffer.from('JPEG-BYTES') },
  }
  return image
}

async function setup(options: { activeCircleId?: string | null; image?: PhotoImage; chosen?: string | null; userId?: number } = {}) {
  const root = await tempRoot()
  const source = join(root, 'grandma.png')
  await writeFile(source, 'png')
  const picker = { choosePhoto: vi.fn(async () => (options.chosen === undefined ? source : options.chosen)) }
  const service = new CirclePhotoService({
    userDataPath: join(root, 'userData'),
    session: { restore: vi.fn(async () => ({ id: options.userId ?? 7 } as never)) },
    users: { getRecordById: vi.fn(async () => ({ activeCircleId: options.activeCircleId === undefined ? 'circle-1' : options.activeCircleId })) },
    images: { fromPath: vi.fn(() => options.image ?? fakeImage(800, 600)) },
    picker,
  })
  return { root, source, service, picker }
}

describe('CirclePhotoService', () => {
  it('crops the chosen picture to a centred square, stores a 256px JPEG and lists it', async () => {
    const log: string[] = []
    const { root, service } = await setup({ image: fakeImage(800, 600, log) })

    const result = await service.choosePhoto('user:88')

    expect(result).toEqual({ status: 'saved', personId: 'user:88', dataUrl: `data:image/jpeg;base64,${Buffer.from('JPEG-BYTES').toString('base64')}` })
    expect(log).toEqual(['crop 100,0 600x600', 'resize 256x256', 'jpeg 85'])
    await expect(service.listPhotos()).resolves.toEqual({ 'user:88': result.status === 'saved' ? result.dataUrl : '' })

    // Server person IDs never become file names.
    const folder = join(root, 'userData', 'circle-photos', 'users', '7')
    const [circleFolder] = await readdir(folder)
    const files = await readdir(join(folder, circleFolder!))
    expect(files.sort()).toEqual([expect.stringMatching(/^[0-9a-f]{32}\.jpg$/), 'index.json'].sort())
    expect(files.join(' ')).not.toContain('user')
  })

  it('keeps photos separate per Circle and per local account', async () => {
    const first = await setup({ activeCircleId: 'circle-1' })
    await first.service.choosePhoto('user:88')
    const other = new CirclePhotoService({
      userDataPath: join(first.root, 'userData'),
      session: { restore: async () => ({ id: 7 } as never) },
      users: { getRecordById: async () => ({ activeCircleId: 'circle-2' }) },
      images: { fromPath: () => fakeImage(10, 10) },
      picker: { choosePhoto: async () => first.source },
    })
    await expect(other.listPhotos()).resolves.toEqual({})
    const otherUser = new CirclePhotoService({
      userDataPath: join(first.root, 'userData'),
      session: { restore: async () => ({ id: 8 } as never) },
      users: { getRecordById: async () => ({ activeCircleId: 'circle-1' }) },
      images: { fromPath: () => fakeImage(10, 10) },
      picker: { choosePhoto: async () => first.source },
    })
    await expect(otherUser.listPhotos()).resolves.toEqual({})
  })

  it('removes a photo', async () => {
    const { service } = await setup()
    await service.choosePhoto('placeholder:3')
    await service.removePhoto('placeholder:3')
    await expect(service.listPhotos()).resolves.toEqual({})
  })

  it('reports a cancelled picker, unsupported files and oversized files without saving', async () => {
    await expect((await setup({ chosen: null })).service.choosePhoto('user:1')).resolves.toEqual({ status: 'canceled' })

    const gif = await setup()
    const gifPath = join(gif.root, 'card.gif')
    await writeFile(gifPath, 'gif')
    gif.picker.choosePhoto.mockResolvedValueOnce(gifPath)
    await expect(gif.service.choosePhoto('user:1')).resolves.toEqual({ status: 'unsupported' })

    const broken = await setup({ image: fakeImage(0, 0) })
    await expect(broken.service.choosePhoto('user:1')).resolves.toEqual({ status: 'unsupported' })

    const big = await setup()
    await writeFile(big.source, Buffer.alloc(MAX_PHOTO_SOURCE_BYTES + 1))
    await expect(big.service.choosePhoto('user:1')).resolves.toEqual({ status: 'too-large' })
    await expect(big.service.listPhotos()).resolves.toEqual({})
  })

  it('requires a session and a person, and ignores a tampered index', async () => {
    const signedOut = new CirclePhotoService({
      userDataPath: await tempRoot(),
      session: { restore: async () => null },
      users: { getRecordById: async () => null },
      images: { fromPath: () => fakeImage(10, 10) },
      picker: { choosePhoto: async () => null },
    })
    await expect(signedOut.listPhotos()).rejects.toThrow('A protected session is required')

    const { root, service } = await setup()
    await expect(service.choosePhoto('  ')).rejects.toThrow('Choose a person in your Circle')
    await service.choosePhoto('user:88')
    const folder = join(root, 'userData', 'circle-photos', 'users', '7')
    const [circleFolder] = await readdir(folder)
    const indexPath = join(folder, circleFolder!, 'index.json')
    const index = JSON.parse(await readFile(indexPath, 'utf8')) as Record<string, string>
    await writeFile(indexPath, JSON.stringify({ ...index, 'user:99': '../../../../secret.txt' }))
    await expect(service.listPhotos()).resolves.toEqual({ 'user:88': expect.stringMatching(/^data:image\/jpeg;base64,/) })
  })

  it('has nothing to list before a Circle is chosen', async () => {
    const { service } = await setup({ activeCircleId: null })
    await expect(service.listPhotos()).resolves.toEqual({})
    await expect(service.choosePhoto('user:1')).rejects.toThrow('Choose a Circle first')
  })
})
