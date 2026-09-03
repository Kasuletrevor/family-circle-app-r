import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AuthUser } from '../../shared/desktopApi'
import type { UserRecord } from './UserRepository'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export interface ProtectedCrypto {
  isAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

export interface SessionFile {
  read(): Promise<Buffer | null>
  write(value: Buffer): Promise<void>
  remove(): Promise<void>
}

export interface SessionEnvelope {
  userId: number
  sessionVersion: number
  expiresAt: number
}

export interface SessionUserSource {
  getRecordById(id: number): Promise<UserRecord | null>
  getSessionVersion(id: number): Promise<number>
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

function isSessionEnvelope(value: unknown): value is SessionEnvelope {
  if (!value || typeof value !== 'object') return false
  const envelope = value as Partial<SessionEnvelope>
  return Number.isInteger(envelope.userId)
    && Number(envelope.userId) > 0
    && Number.isInteger(envelope.sessionVersion)
    && Number(envelope.sessionVersion) >= 0
    && typeof envelope.expiresAt === 'number'
    && Number.isFinite(envelope.expiresAt)
}

export function createProtectedCrypto(safeStorage: SafeStorageLike): ProtectedCrypto {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  }
}

export function createSessionFile(filePath: string): SessionFile {
  return {
    async read() {
      try {
        return await readFile(filePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    async write(value) {
      await mkdir(dirname(filePath), { recursive: true })
      const temporaryPath = `${filePath}.tmp`
      await writeFile(temporaryPath, value, { mode: 0o600 })
      await rename(temporaryPath, filePath)
    },
    async remove() {
      await rm(filePath, { force: true })
      await rm(`${filePath}.tmp`, { force: true })
    },
  }
}

export class SessionStore {
  constructor(
    private readonly users: SessionUserSource,
    private readonly crypto: ProtectedCrypto,
    private readonly file: SessionFile,
    private readonly now: () => number = Date.now,
  ) {}

  async save(userId: number): Promise<void> {
    if (!this.crypto.isAvailable()) {
      throw new Error('Protected session storage is unavailable')
    }

    const sessionVersion = await this.users.getSessionVersion(userId)
    const envelope: SessionEnvelope = {
      userId,
      sessionVersion,
      expiresAt: this.now() + THIRTY_DAYS_MS,
    }
    const protectedBytes = this.crypto.encrypt(JSON.stringify(envelope))
    await this.file.write(protectedBytes)
  }

  async restore(): Promise<AuthUser | null> {
    const protectedBytes = await this.file.read()
    if (!protectedBytes) return null

    if (!this.crypto.isAvailable()) {
      await this.clear()
      return null
    }

    try {
      const envelopeValue = JSON.parse(this.crypto.decrypt(protectedBytes)) as unknown
      if (!isSessionEnvelope(envelopeValue) || envelopeValue.expiresAt <= this.now()) {
        await this.clear()
        return null
      }

      const record = await this.users.getRecordById(envelopeValue.userId)
      if (!record || record.sessionVersion !== envelopeValue.sessionVersion) {
        await this.clear()
        return null
      }

      return record.user
    } catch {
      await this.clear()
      return null
    }
  }

  async clear(): Promise<void> {
    await this.file.remove()
  }
}
