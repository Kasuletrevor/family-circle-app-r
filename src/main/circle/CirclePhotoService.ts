import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { AuthUser } from '../../shared/desktopApi'
import { noMutationLock, type MutationLock } from '../storage/MutationLock'

/** Photos are shown at most this size, so they are stored at it. */
export const PHOTO_SIZE_PX = 256
export const MAX_PHOTO_SOURCE_BYTES = 20 * 1024 * 1024
const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png'])
const MAX_PERSON_ID_LENGTH = 200

/** The image operations needed, provided by Electron's nativeImage in the app. */
export interface PhotoImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  crop(rect: { x: number; y: number; width: number; height: number }): PhotoImage
  resize(options: { width: number; height: number; quality: 'best' }): PhotoImage
  toJPEG(quality: number): Buffer
}

export interface CirclePhotoServiceDependencies {
  userDataPath: string
  session: { restore(): Promise<AuthUser | null> }
  users: { getRecordById(id: number): Promise<{ activeCircleId: string | null } | null> }
  images: { fromPath(path: string): PhotoImage }
  picker: { choosePhoto(): Promise<string | null> }
  /**
   * The lock shared with backup, Vault and My Story writes. Photo files and their index
   * change only while holding it, so overlapping changes and backups stay consistent.
   */
  mutationLock?: MutationLock
}

export type CirclePhotoChoice =
  | { status: 'saved'; personId: string; dataUrl: string }
  | { status: 'canceled' }
  | { status: 'unsupported' }
  | { status: 'too-large' }

export class CirclePhotoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CirclePhotoError'
  }
}

type PhotoIndex = Record<string, string>

function hashed(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

function requirePersonId(value: unknown): string {
  const personId = String(value ?? '').trim()
  if (!personId || personId.length > MAX_PERSON_ID_LENGTH) throw new CirclePhotoError('Choose a person in your Circle')
  return personId
}

function dataUrl(bytes: Buffer): string {
  return `data:image/jpeg;base64,${bytes.toString('base64')}`
}

/**
 * Profile photos for people in a Circle, chosen on this computer and kept only here.
 * Stored per local account and per Circle under hashed names (person IDs come from the
 * Circle server), as square 256px JPEGs re-encoded from the chosen picture, which
 * also drops hidden metadata such as GPS location.
 */
export class CirclePhotoService {
  private readonly lock: MutationLock

  constructor(private readonly dependencies: CirclePhotoServiceDependencies) {
    this.lock = dependencies.mutationLock ?? noMutationLock
  }

  /** Photos for the active Circle, by person ID. */
  async listPhotos(): Promise<Record<string, string>> {
    const folder = await this.activeFolder()
    if (!folder) return {}
    const index = await this.readIndex(folder)
    const photos: Record<string, string> = {}
    for (const [personId, fileName] of Object.entries(index)) {
      try {
        photos[personId] = dataUrl(await readFile(join(folder, fileName)))
      } catch {
        // A missing file just means no photo for that person.
      }
    }
    return photos
  }

  async choosePhoto(personIdInput: unknown): Promise<CirclePhotoChoice> {
    const personId = requirePersonId(personIdInput)
    const folder = await this.activeFolder()
    if (!folder) throw new CirclePhotoError('Choose a Circle first')

    const source = await this.dependencies.picker.choosePhoto()
    if (!source) return { status: 'canceled' }
    if (!PHOTO_EXTENSIONS.has(extname(source).toLowerCase())) return { status: 'unsupported' }
    const info = await stat(source).catch(() => null)
    if (!info?.isFile()) return { status: 'unsupported' }
    if (info.size > MAX_PHOTO_SOURCE_BYTES) return { status: 'too-large' }

    const image = this.dependencies.images.fromPath(source)
    if (image.isEmpty()) return { status: 'unsupported' }
    const { width, height } = image.getSize()
    const side = Math.min(width, height)
    if (side < 1) return { status: 'unsupported' }
    const square = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
    const bytes = square.resize({ width: PHOTO_SIZE_PX, height: PHOTO_SIZE_PX, quality: 'best' }).toJPEG(85)
    if (bytes.length === 0) return { status: 'unsupported' }

    // The picker and image work happen before taking the lock, so an open file dialog
    // never holds up a backup.
    await this.lock.runExclusive(async () => {
      await mkdir(folder, { recursive: true })
      const fileName = `${hashed(personId)}.jpg`
      const temporary = join(folder, `.${fileName}.${randomUUID()}.tmp`)
      await writeFile(temporary, bytes)
      await rename(temporary, join(folder, fileName))
      const index = await this.readIndex(folder)
      index[personId] = fileName
      await this.writeIndex(folder, index)
    })
    return { status: 'saved', personId, dataUrl: dataUrl(bytes) }
  }

  async removePhoto(personIdInput: unknown): Promise<{ success: true }> {
    const personId = requirePersonId(personIdInput)
    const folder = await this.activeFolder()
    if (!folder) return { success: true }
    await this.lock.runExclusive(async () => {
      const index = await this.readIndex(folder)
      const fileName = index[personId]
      if (fileName) {
        delete index[personId]
        await this.writeIndex(folder, index)
        await rm(join(folder, fileName), { force: true })
      }
    })
    return { success: true }
  }

  private async activeFolder(): Promise<string | null> {
    const user = await this.dependencies.session.restore()
    if (!user) throw new CirclePhotoError('A protected session is required')
    const record = await this.dependencies.users.getRecordById(user.id)
    const circleId = String(record?.activeCircleId ?? '').trim()
    if (!circleId) return null
    return join(this.dependencies.userDataPath, 'circle-photos', 'users', String(user.id), hashed(circleId))
  }

  private async readIndex(folder: string): Promise<PhotoIndex> {
    try {
      const parsed = JSON.parse(await readFile(join(folder, 'index.json'), 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /^[0-9a-f]{32}\.jpg$/.test(entry[1])))
    } catch {
      return {}
    }
  }

  private async writeIndex(folder: string, index: PhotoIndex): Promise<void> {
    const temporary = join(folder, `.index.${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(index, null, 2))
    await rename(temporary, join(folder, 'index.json'))
  }
}
