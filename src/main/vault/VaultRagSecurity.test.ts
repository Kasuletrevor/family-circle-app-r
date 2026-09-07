import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiRuntimeManager } from '../ai/AiRuntimeManager'
import { OfflineAiAssetService } from '../ai/OfflineAiAssetService'
import { runMigrations } from '../database/migrations'
import { VaultChunkRepository } from './VaultChunkRepository'
import { VaultIndexService } from './VaultIndexService'
import { VaultQueryService, type VaultQueryServiceDependencies } from './VaultQueryService'
import { float32ToBlob } from './vectorCodec'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function queryDeps(overrides: Partial<VaultQueryServiceDependencies> = {}): VaultQueryServiceDependencies {
  return {
    session: { restore: vi.fn(async () => ({ id: 7 } as never)) },
    documents: { getByIdForUser: vi.fn(async (_userId, id) => ({ id, deleteStatus: 'active' })) },
    chunks: {
      listQueryChunks: vi.fn(async () => [{
        documentId: 1,
        fileName: 'History.pdf',
        chunkIndex: 0,
        text: 'Known private fact',
        embedding: new Float32Array([1, 0]),
        embeddingModel: 'nomic',
        indexVersion: 1,
      }]),
    },
    runtime: {
      ensureEmbeddingRuntime: vi.fn(async () => true),
      ensureGenerationRuntime: vi.fn(async () => true),
    },
    nomic: {
      embedQuery: vi.fn(async () => new Float32Array([1, 0])),
      embedDocument: vi.fn(async () => new Float32Array([1, 0])),
    },
    granite: { generate: vi.fn(async () => 'Grounded answer') },
    ...overrides,
  }
}

function insertUser(db: DatabaseSync, id: number, email: string): void {
  db.prepare(`
    INSERT INTO users (id, email, password_hash, created_at, updated_at)
    VALUES (?, ?, 'hash', 1, 1)
  `).run(id, email)
}

function insertIndexedDocument(db: DatabaseSync, id: number, userId: number, fileName: string): void {
  db.prepare(`
    INSERT INTO vault_documents (
      id, local_user_id, file_name, file_type, mime_type, size_bytes, sha256,
      stored_relative_path, extraction_status, index_status, word_count,
      extracted_text, delete_status, uploaded_at, updated_at
    ) VALUES (?, ?, ?, 'txt', 'text/plain', 10, ?, ?, 'ready', 'indexed', 2, ?, 'active', 1, 1)
  `).run(id, userId, fileName, `hash-${id}`, `users/${userId}/${id}.txt`, `private text ${id}`)

  db.prepare(`
    INSERT INTO vault_chunks (
      document_id, chunk_index, text, embedding_blob, embedding_model,
      index_version, created_at, updated_at
    ) VALUES (?, 0, ?, ?, 'nomic', 1, 1, 1)
  `).run(id, `chunk ${id}`, float32ToBlob(new Float32Array([1, id])))
}

describe('Vault RAG privacy and lifecycle boundaries', () => {
  it('cannot query another user selected ids', async () => {
    const listQueryChunks = vi.fn(async () => [])
    const getByIdForUser = vi.fn(async (_userId: number, documentId: number) => (
      documentId === 99 ? null : { id: documentId, deleteStatus: 'active' }
    ))
    const service = new VaultQueryService(queryDeps({
      documents: { getByIdForUser },
      chunks: { listQueryChunks },
    }))

    await expect(service.ask({
      question: 'Private question?',
      scope: { type: 'documents', documentIds: [1, 99] },
    })).rejects.toMatchObject({ code: 'invalid-scope' })
    expect(listQueryChunks).not.toHaveBeenCalled()
  })

  it('cannot retrieve another user chunks', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    runMigrations(db)
    insertUser(db, 1, 'one@example.test')
    insertUser(db, 2, 'two@example.test')
    insertIndexedDocument(db, 10, 1, 'One.txt')
    insertIndexedDocument(db, 20, 2, 'Two.txt')

    const repository = new VaultChunkRepository(db)
    const userOne = await repository.listQueryChunks(1)
    const userTwo = await repository.listQueryChunks(2)

    expect(userOne.map((row) => row.documentId)).toEqual([10])
    expect(userTwo.map((row) => row.documentId)).toEqual([20])
    expect(userOne.some((row) => row.text.includes('20'))).toBe(false)
    db.close()
  })

  it('never sends Vault content to Circle adapter', async () => {
    const source = await readFile(join(process.cwd(), 'src/main/vault/VaultQueryService.ts'), 'utf8')
    expect(source).not.toMatch(/CircleService|LegacyCircle|circleAdapter|CIRCLE_API/)
  })

  it('never cloud-falls-back', async () => {
    const granite = await readFile(join(process.cwd(), 'src/main/ai/GraniteClient.ts'), 'utf8')
    const query = await readFile(join(process.cwd(), 'src/main/vault/VaultQueryService.ts'), 'utf8')
    expect(granite).toContain("host: '127.0.0.1'")
    expect(granite).not.toMatch(/node:https|\bfetch\s*\(|https:\/\//)
    expect(query).not.toMatch(/\bfetch\s*\(|https?:\/\//)
  })

  it('never re-embeds document chunks on ask', async () => {
    const embedQuery = vi.fn(async () => new Float32Array([1, 0]))
    const embedDocument = vi.fn(async () => new Float32Array([0, 1]))
    const service = new VaultQueryService(queryDeps({ nomic: { embedQuery, embedDocument } }))

    await service.ask({ question: 'Known?', scope: { type: 'all' } })
    expect(embedQuery).toHaveBeenCalledTimes(1)
    expect(embedDocument).not.toHaveBeenCalled()
  })

  it('never downloads until explicit setup or repair', async () => {
    const root = await mkdtemp(join(tmpdir(), 'family-circle-ai-security-'))
    tempRoots.push(root)
    const manifestPath = join(root, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify({ version: 'test', files: [] }), 'utf8')
    const downloadAll = vi.fn(async () => ({ paused: false }))
    const downloader = { downloadAll, pause: vi.fn() }

    const service = new OfflineAiAssetService({ userDataPath: root, manifestPath, downloader })
    expect(downloadAll).not.toHaveBeenCalled()
    await expect(service.getStatus()).resolves.toMatchObject({ state: 'not_installed' })
    expect(downloadAll).not.toHaveBeenCalled()
  })

  it('never starts Granite for indexing', async () => {
    const ensureEmbeddingRuntime = vi.fn(async () => true)
    const ensureGenerationRuntime = vi.fn(async () => true)
    const runtime = { ensureEmbeddingRuntime, ensureGenerationRuntime }
    const replaceDocumentIndex = vi.fn(async () => undefined)
    const service = new VaultIndexService({
      documents: {
        getByIdForUser: vi.fn(async () => ({
          id: 5,
          localUserId: 7,
          fileName: 'History.txt',
          fileType: 'txt',
          mimeType: 'text/plain',
          sizeBytes: 20,
          sha256: 'hash',
          storedRelativePath: 'users/7/5.txt',
          extractionStatus: 'ready',
          indexStatus: 'waiting_for_ai',
          wordCount: 3,
          preview: 'Known fact',
          extractedText: 'Known family fact',
          lastErrorCode: null,
          deleteStatus: 'active',
          uploadedAt: 1,
          updatedAt: 1,
        })),
        listByUser: vi.fn(async () => []),
        markIndexing: vi.fn(async () => undefined),
        markIndexFailure: vi.fn(async () => undefined),
      },
      chunks: { replaceDocumentIndex },
      runtime,
      nomic: { embedDocument: vi.fn(async () => new Float32Array([1, 0])) },
      assets: { getStatus: vi.fn(async () => ({ state: 'ready' })) },
    })

    await service.indexDocument(7, 5)
    expect(ensureEmbeddingRuntime).toHaveBeenCalledTimes(1)
    expect(ensureGenerationRuntime).not.toHaveBeenCalled()
    expect(replaceDocumentIndex).toHaveBeenCalledTimes(1)
  })

  it('starts no AI process at construction', () => {
    const spawn = vi.fn()
    new AiRuntimeManager({
      assets: { getInstalledPaths: vi.fn(async () => null) },
      process: { spawn },
      health: { check: vi.fn(async () => false) },
    })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('keeps upload and extraction independent from AI readiness', async () => {
    const source = await readFile(join(process.cwd(), 'src/main/vault/VaultService.ts'), 'utf8')
    expect(source).not.toMatch(/OfflineAiAssetService|PrivateAi|ensureEmbeddingRuntime|ensureGenerationRuntime/)
    expect(source).toContain('indexQueue')
  })
})
