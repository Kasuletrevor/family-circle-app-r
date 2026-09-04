import { createHash } from 'node:crypto'
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_VAULT_FILE_BYTES,
  VaultFileStore,
  sha256File,
  validateSelectedDocument,
} from './VaultFileStore'

const temporaryDirectories: string[] = []

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'family-circle-vault-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Vault document validation and file storage', () => {
  it('accepts valid txt under 50 MiB', async () => {
    const directory = await tempDirectory()
    const filePath = join(directory, 'Family History.TXT')
    await writeFile(filePath, 'A private family note.', 'utf8')

    await expect(validateSelectedDocument(filePath)).resolves.toMatchObject({
      fileType: 'txt',
      mimeType: 'text/plain',
      extension: '.txt',
      sizeBytes: Buffer.byteLength('A private family note.'),
    })
  })

  it('rejects unsupported extensions', async () => {
    const directory = await tempDirectory()
    const filePath = join(directory, 'Family History.rtf')
    await writeFile(filePath, '{\\rtf1 unsupported}', 'utf8')

    await expect(validateSelectedDocument(filePath)).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('rejects >50 MiB before extraction', async () => {
    const directory = await tempDirectory()
    const filePath = join(directory, 'too-large.txt')
    const handle = await open(filePath, 'w')
    await handle.truncate(MAX_VAULT_FILE_BYTES + 1)
    await handle.close()

    await expect(validateSelectedDocument(filePath)).rejects.toMatchObject({ code: 'too-large' })
  })

  it('checks %PDF- header for pdf', async () => {
    const directory = await tempDirectory()
    const validPath = join(directory, 'valid.pdf')
    const invalidPath = join(directory, 'renamed.pdf')
    await writeFile(validPath, Buffer.from('%PDF-1.7\nbody'))
    await writeFile(invalidPath, Buffer.from('not a pdf'))

    await expect(validateSelectedDocument(validPath)).resolves.toMatchObject({ fileType: 'pdf' })
    await expect(validateSelectedDocument(invalidPath)).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('checks PK zip signature for docx', async () => {
    const directory = await tempDirectory()
    const validPath = join(directory, 'valid.docx')
    const invalidPath = join(directory, 'renamed.docx')
    await writeFile(validPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]))
    await writeFile(invalidPath, Buffer.from('not a docx'))

    await expect(validateSelectedDocument(validPath)).resolves.toMatchObject({ fileType: 'docx' })
    await expect(validateSelectedDocument(invalidPath)).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('streams SHA-256 hashing', async () => {
    const directory = await tempDirectory()
    const filePath = join(directory, 'hash-me.txt')
    const content = 'letters, memories, and photographs'
    await writeFile(filePath, content, 'utf8')

    await expect(sha256File(filePath)).resolves.toBe(createHash('sha256').update(content).digest('hex'))
  })

  it('stores under vault/users/<id>/documents with a random storage name', async () => {
    const userDataPath = await tempDirectory()
    const sourceDirectory = await tempDirectory()
    const sourcePath = join(sourceDirectory, 'Family History.txt')
    await writeFile(sourcePath, 'keep this private', 'utf8')
    const store = new VaultFileStore(userDataPath)

    const storedRelativePath = await store.copyIntoVault(7, sourcePath, '.txt')
    const normalized = storedRelativePath.replaceAll('\\', '/')
    expect(normalized).toMatch(/^vault\/users\/7\/documents\/[0-9a-f-]+\.txt$/i)

    const ownedAbsolutePath = store.resolveOwnedPath(7, storedRelativePath)
    expect(basename(ownedAbsolutePath)).not.toBe('Family History.txt')
    await expect(readFile(ownedAbsolutePath, 'utf8')).resolves.toBe('keep this private')
  })

  it('rejects relative-path traversal outside the user root', async () => {
    const userDataPath = await tempDirectory()
    const store = new VaultFileStore(userDataPath)

    expect(() => store.resolveOwnedPath(7, '../outside.txt')).toThrow()
    expect(() => store.resolveOwnedPath(7, 'vault/users/8/documents/other.txt')).toThrow()
    expect(() => store.resolveOwnedPath(7, 'vault/users/7/documents/../../8/documents/other.txt')).toThrow()
  })

  it('treats ENOENT as successful cleanup', async () => {
    const userDataPath = await tempDirectory()
    const store = new VaultFileStore(userDataPath)

    await expect(store.deleteOwnedFile(7, 'vault/users/7/documents/already-gone.txt')).resolves.toBeUndefined()
  })
})
