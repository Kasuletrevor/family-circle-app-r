import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, stat, unlink } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'

export type StoryMediaType = 'photo' | 'audio'
export const MAX_STORY_PHOTO_BYTES = 25 * 1024 * 1024
export const MAX_STORY_AUDIO_BYTES = 100 * 1024 * 1024

interface MediaDescriptor {
  mediaType: StoryMediaType
  mimeType: string
  extension: string
}

const MEDIA: Record<string, MediaDescriptor> = {
  '.jpg': { mediaType: 'photo', mimeType: 'image/jpeg', extension: '.jpg' },
  '.jpeg': { mediaType: 'photo', mimeType: 'image/jpeg', extension: '.jpeg' },
  '.png': { mediaType: 'photo', mimeType: 'image/png', extension: '.png' },
  '.gif': { mediaType: 'photo', mimeType: 'image/gif', extension: '.gif' },
  '.webp': { mediaType: 'photo', mimeType: 'image/webp', extension: '.webp' },
  '.mp3': { mediaType: 'audio', mimeType: 'audio/mpeg', extension: '.mp3' },
  '.wav': { mediaType: 'audio', mimeType: 'audio/wav', extension: '.wav' },
  '.m4a': { mediaType: 'audio', mimeType: 'audio/mp4', extension: '.m4a' },
  '.ogg': { mediaType: 'audio', mimeType: 'audio/ogg', extension: '.ogg' },
  '.flac': { mediaType: 'audio', mimeType: 'audio/flac', extension: '.flac' },
  '.webm': { mediaType: 'audio', mimeType: 'audio/webm', extension: '.webm' },
}

export interface ValidatedStoryMedia extends MediaDescriptor {
  sizeBytes: number
}

export class StoryMediaStoreError extends Error {
  constructor(public readonly code: 'unsupported' | 'too-large', message: string) {
    super(message)
    this.name = 'StoryMediaStoreError'
  }
}

async function readPrefix(filePath: string, length = 16): Promise<Buffer> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

function matchesSignature(extension: string, prefix: Buffer): boolean {
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff
    case '.png':
      return prefix.length >= 8 && prefix.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
    case '.gif': {
      const value = prefix.subarray(0, 6).toString('ascii')
      return value === 'GIF87a' || value === 'GIF89a'
    }
    case '.webp':
      return prefix.length >= 12 && prefix.subarray(0, 4).toString('ascii') === 'RIFF' && prefix.subarray(8, 12).toString('ascii') === 'WEBP'
    case '.mp3':
      return prefix.subarray(0, 3).toString('ascii') === 'ID3' || (prefix.length >= 2 && prefix[0] === 0xff && (prefix[1]! & 0xe0) === 0xe0)
    case '.wav':
      return prefix.length >= 12 && prefix.subarray(0, 4).toString('ascii') === 'RIFF' && prefix.subarray(8, 12).toString('ascii') === 'WAVE'
    case '.m4a':
      return prefix.length >= 8 && prefix.subarray(4, 8).toString('ascii') === 'ftyp'
    case '.ogg':
      return prefix.subarray(0, 4).toString('ascii') === 'OggS'
    case '.flac':
      return prefix.subarray(0, 4).toString('ascii') === 'fLaC'
    case '.webm':
      return prefix.length >= 4 && prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3
    default:
      return false
  }
}

function requireUserId(localUserId: number): void {
  if (!Number.isSafeInteger(localUserId) || localUserId <= 0) throw new Error('Invalid local user id')
}

function requireStorageExtension(extension: string): string {
  const normalized = extension.toLowerCase()
  if (!MEDIA[normalized]) throw new StoryMediaStoreError('unsupported', 'Unsupported Story media type')
  return normalized
}

export class StoryMediaStore {
  constructor(private readonly userDataPath: string) {}

  async validateSelected(filePath: string, expectedType: StoryMediaType): Promise<ValidatedStoryMedia> {
    const extension = extname(filePath).toLowerCase()
    const descriptor = MEDIA[extension]
    if (!descriptor || descriptor.mediaType !== expectedType) throw new StoryMediaStoreError('unsupported', 'Unsupported Story media type')

    const metadata = await stat(filePath)
    if (!metadata.isFile()) throw new StoryMediaStoreError('unsupported', 'Unsupported Story media type')
    const limit = expectedType === 'photo' ? MAX_STORY_PHOTO_BYTES : MAX_STORY_AUDIO_BYTES
    if (metadata.size > limit) throw new StoryMediaStoreError('too-large', 'Story media exceeds the size limit')

    if (!matchesSignature(extension, await readPrefix(filePath))) {
      throw new StoryMediaStoreError('unsupported', 'Unsupported Story media type')
    }
    return { ...descriptor, sizeBytes: metadata.size }
  }

  async copyIntoStory(localUserId: number, sourcePath: string, extension: string): Promise<string> {
    requireUserId(localUserId)
    const safeExtension = requireStorageExtension(extension)
    const root = this.userMediaRoot(localUserId)
    await mkdir(root, { recursive: true })
    const destination = join(root, `${randomUUID()}${safeExtension}`)
    await copyFile(sourcePath, destination)
    return relative(resolve(this.userDataPath), destination)
  }

  resolveOwnedPath(localUserId: number, storedRelativePath: string): string {
    requireUserId(localUserId)
    if (!storedRelativePath || storedRelativePath.includes('\0')) throw new Error('Invalid Story media path')
    const root = this.userMediaRoot(localUserId)
    const candidate = resolve(this.userDataPath, storedRelativePath)
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`
    if (!candidate.startsWith(prefix)) throw new Error('Story media path is not owned by this user')
    return candidate
  }

  async deleteOwnedFile(localUserId: number, storedRelativePath: string): Promise<void> {
    const absolutePath = this.resolveOwnedPath(localUserId, storedRelativePath)
    try {
      await unlink(absolutePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }

  private userMediaRoot(localUserId: number): string {
    requireUserId(localUserId)
    return resolve(this.userDataPath, 'story', 'users', String(localUserId), 'media')
  }
}
