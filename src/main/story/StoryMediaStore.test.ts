import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_STORY_AUDIO_BYTES, MAX_STORY_PHOTO_BYTES, StoryMediaStore } from './StoryMediaStore'

const roots: string[] = []
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'story-media-'))
  roots.push(root)
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

const cases = [
  ['photo', '.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
  ['photo', '.jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe1]), 'image/jpeg'],
  ['photo', '.png', Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), 'image/png'],
  ['photo', '.gif', Buffer.from('GIF89a'), 'image/gif'],
  ['photo', '.webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]), 'image/webp'],
  ['audio', '.mp3', Buffer.from('ID3\x04\x00\x00'), 'audio/mpeg'],
  ['audio', '.wav', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]), 'audio/wav'],
  ['audio', '.m4a', Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A ')]), 'audio/mp4'],
  ['audio', '.ogg', Buffer.from('OggS\x00'), 'audio/ogg'],
  ['audio', '.flac', Buffer.from('fLaC'), 'audio/flac'],
  ['audio', '.webm', Buffer.from([0x1a,0x45,0xdf,0xa3]), 'audio/webm'],
] as const

describe('StoryMediaStore', () => {
  it.each(cases)('validates %s %s by extension and container marker', async (mediaType, extension, prefix, mimeType) => {
    const root = await tempRoot()
    const file = join(root, `sample${extension}`)
    await writeFile(file, prefix)
    const store = new StoryMediaStore(join(root, 'userdata'))

    await expect(store.validateSelected(file, mediaType)).resolves.toMatchObject({ mediaType, extension, mimeType, sizeBytes: prefix.length })
  })

  it('rejects type/extension mismatch and spoofed signatures', async () => {
    const root = await tempRoot()
    const jpg = join(root, 'wrong.jpg')
    const wav = join(root, 'wrong.wav')
    await writeFile(jpg, Buffer.from([0xff, 0xd8, 0xff]))
    await writeFile(wav, Buffer.from('not a wav'))
    const store = new StoryMediaStore(join(root, 'userdata'))

    await expect(store.validateSelected(jpg, 'audio')).rejects.toMatchObject({ code: 'unsupported' })
    await expect(store.validateSelected(wav, 'audio')).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('enforces the exact photo/audio limits without reading the whole file', async () => {
    const root = await tempRoot()
    const photo = join(root, 'large.jpg')
    const audio = join(root, 'large.wav')
    await writeFile(photo, Buffer.from([0xff, 0xd8, 0xff]))
    await truncate(photo, MAX_STORY_PHOTO_BYTES + 1)
    await writeFile(audio, Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]))
    await truncate(audio, MAX_STORY_AUDIO_BYTES + 1)
    const store = new StoryMediaStore(join(root, 'userdata'))

    await expect(store.validateSelected(photo, 'photo')).rejects.toMatchObject({ code: 'too-large' })
    await expect(store.validateSelected(audio, 'audio')).rejects.toMatchObject({ code: 'too-large' })
  })

  it('copies to a randomized owned relative path and rejects traversal/cross-user paths', async () => {
    const root = await tempRoot()
    const userData = join(root, 'userdata')
    const source = join(root, 'photo.jpg')
    await writeFile(source, Buffer.from([0xff,0xd8,0xff,1,2,3]))
    const store = new StoryMediaStore(userData)

    const first = await store.copyIntoStory(7, source, '.jpg')
    const second = await store.copyIntoStory(7, source, '.jpg')
    expect(first).not.toBe(second)
    expect(first).toMatch(/^story[\\/]users[\\/]7[\\/]media[\\/][0-9a-f-]+\.jpg$/i)
    expect(await readFile(store.resolveOwnedPath(7, first))).toEqual(await readFile(source))
    expect(relative(userData, store.resolveOwnedPath(7, first))).toBe(first)
    expect(() => store.resolveOwnedPath(7, '../secret.jpg')).toThrow('owned')
    expect(() => store.resolveOwnedPath(8, first)).toThrow('owned')

    await store.deleteOwnedFile(7, first)
    await expect(store.deleteOwnedFile(7, first)).resolves.toBeUndefined()
  })
})
