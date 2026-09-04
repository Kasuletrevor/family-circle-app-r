import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, open, stat, unlink } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import type { VaultFileType } from './vaultModels'

export const MAX_VAULT_FILE_BYTES = 50 * 1024 * 1024

const SUPPORTED_DOCUMENTS: Record<string, { fileType: VaultFileType; mimeType: string }> = {
  '.pdf': { fileType: 'pdf', mimeType: 'application/pdf' },
  '.docx': {
    fileType: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.txt': { fileType: 'txt', mimeType: 'text/plain' },
}

export class VaultFileError extends Error {
  constructor(public readonly code: 'unsupported' | 'too-large', message: string) {
    super(message)
    this.name = 'VaultFileError'
  }
}

export interface ValidatedSelectedDocument {
  fileType: VaultFileType
  mimeType: string
  extension: '.pdf' | '.docx' | '.txt'
  sizeBytes: number
}

async function readPrefix(filePath: string, length: number): Promise<Buffer> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

function hasPdfSignature(prefix: Buffer): boolean {
  return prefix.length >= 5 && prefix.subarray(0, 5).toString('ascii') === '%PDF-'
}

function hasDocxSignature(prefix: Buffer): boolean {
  return prefix.length >= 4
    && prefix[0] === 0x50
    && prefix[1] === 0x4b
    && prefix[2] === 0x03
    && prefix[3] === 0x04
}

export async function validateSelectedDocument(filePath: string): Promise<ValidatedSelectedDocument> {
  const extension = extname(filePath).toLowerCase()
  const supported = SUPPORTED_DOCUMENTS[extension]
  if (!supported) throw new VaultFileError('unsupported', 'Unsupported document type')

  const metadata = await stat(filePath)
  if (!metadata.isFile()) throw new VaultFileError('unsupported', 'Unsupported document type')
  if (metadata.size > MAX_VAULT_FILE_BYTES) {
    throw new VaultFileError('too-large', 'Document exceeds the Vault size limit')
  }

  if (extension === '.pdf' && !hasPdfSignature(await readPrefix(filePath, 5))) {
    throw new VaultFileError('unsupported', 'Unsupported document type')
  }
  if (extension === '.docx' && !hasDocxSignature(await readPrefix(filePath, 4))) {
    throw new VaultFileError('unsupported', 'Unsupported document type')
  }

  return {
    fileType: supported.fileType,
    mimeType: supported.mimeType,
    extension: extension as ValidatedSelectedDocument['extension'],
    sizeBytes: metadata.size,
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

function requireLocalUserId(localUserId: number): void {
  if (!Number.isSafeInteger(localUserId) || localUserId <= 0) {
    throw new Error('Invalid local user id')
  }
}

function requireStorageExtension(extension: string): '.pdf' | '.docx' | '.txt' {
  const normalized = extension.toLowerCase()
  if (normalized !== '.pdf' && normalized !== '.docx' && normalized !== '.txt') {
    throw new VaultFileError('unsupported', 'Unsupported document type')
  }
  return normalized
}

export class VaultFileStore {
  constructor(private readonly userDataPath: string) {}

  async copyIntoVault(localUserId: number, sourcePath: string, extension: string): Promise<string> {
    requireLocalUserId(localUserId)
    const safeExtension = requireStorageExtension(extension)
    const userRoot = this.userDocumentsRoot(localUserId)
    await mkdir(userRoot, { recursive: true })

    const destinationPath = join(userRoot, `${randomUUID()}${safeExtension}`)
    await copyFile(sourcePath, destinationPath)
    return relative(resolve(this.userDataPath), destinationPath)
  }

  resolveOwnedPath(localUserId: number, storedRelativePath: string): string {
    requireLocalUserId(localUserId)
    if (!storedRelativePath || storedRelativePath.includes('\0')) {
      throw new Error('Invalid Vault storage path')
    }

    const userRoot = this.userDocumentsRoot(localUserId)
    const candidate = resolve(this.userDataPath, storedRelativePath)
    const prefix = userRoot.endsWith(sep) ? userRoot : `${userRoot}${sep}`

    if (!candidate.startsWith(prefix)) throw new Error('Vault storage path is not owned by this user')
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

  private userDocumentsRoot(localUserId: number): string {
    requireLocalUserId(localUserId)
    return resolve(this.userDataPath, 'vault', 'users', String(localUserId), 'documents')
  }
}
