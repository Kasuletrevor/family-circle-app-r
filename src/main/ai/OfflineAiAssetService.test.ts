import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfflineAiAssetService } from './OfflineAiAssetService'
import type { OfflineAiManifest } from './privateAiModels'

const tempRoots: string[] = []

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex').toUpperCase()
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'family-circle-ai-assets-'))
  tempRoots.push(root)
  const userDataPath = join(root, 'user-data')
  const manifestPath = join(root, 'offline-ai-manifest.json')
  const graniteBytes = 'granite-test-bytes'
  const nomicBytes = 'nomic-test-bytes'
  const runtimeZipBytes = 'runtime-zip-test-bytes'
  const manifest: OfflineAiManifest = {
    version: 'test-1',
    files: [
      {
        name: 'AI engine',
        type: 'runtime',
        url: 'https://example.invalid/runtime.zip',
        targetPath: 'bin/runtime',
        sha256: sha256(runtimeZipBytes),
        sizeBytes: Buffer.byteLength(runtimeZipBytes),
        extract: true,
        required: true,
      },
      {
        name: 'AI knowledge',
        type: 'model',
        url: 'https://example.invalid/granite.gguf',
        targetPath: 'models/granite.gguf',
        sha256: sha256(graniteBytes),
        sizeBytes: Buffer.byteLength(graniteBytes),
        extract: false,
        required: true,
      },
      {
        name: 'AI search',
        type: 'embedding',
        url: 'https://example.invalid/nomic.gguf',
        targetPath: 'models/nomic.gguf',
        sha256: sha256(nomicBytes),
        sizeBytes: Buffer.byteLength(nomicBytes),
        extract: false,
        required: true,
      },
    ],
  }
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')

  const downloader = {
    downloadAll: vi.fn(async () => ({ paused: false })),
    pause: vi.fn(),
  }
  const service = new OfflineAiAssetService({ userDataPath, manifestPath, downloader })
  const offlineAiRoot = join(userDataPath, 'offline-ai')

  async function write(relativePath: string, contents: string) {
    const absolutePath = join(offlineAiRoot, relativePath)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, contents)
  }

  async function writeMarker() {
    await write('installed-version.json', JSON.stringify({ version: manifest.version }))
  }

  async function writeValidInstalledAssets() {
    await write('bin/runtime/llama-server.exe', 'fake executable')
    await write('models/granite.gguf', graniteBytes)
    await write('models/nomic.gguf', nomicBytes)
    await writeMarker()
  }

  return { service, manifest, offlineAiRoot, write, writeMarker, writeValidInstalledAssets }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('OfflineAiAssetService installed asset state', () => {
  it('reports not_installed with no assets', async () => {
    const { service } = await makeFixture()
    await expect(service.getStatus()).resolves.toMatchObject({ state: 'not_installed' })
    await expect(service.getInstalledPaths()).resolves.toBeNull()
  })

  it('never considers .part ready', async () => {
    const { service, manifest, write } = await makeFixture()
    await write(`.staging/${manifest.version}/models/granite.gguf.part`, 'granite-test-bytes')

    const status = await service.getStatus()
    expect(status.state).not.toBe('ready')
    await expect(service.getInstalledPaths()).resolves.toBeNull()
  })

  it('reports repair_required when marker exists but required asset is invalid', async () => {
    const { service, writeMarker } = await makeFixture()
    await writeMarker()

    await expect(service.getStatus()).resolves.toMatchObject({ state: 'repair_required' })
    await expect(service.getInstalledPaths()).resolves.toBeNull()
  })

  it('reports ready only after all required assets verify', async () => {
    const { service, offlineAiRoot, writeValidInstalledAssets } = await makeFixture()
    await writeValidInstalledAssets()

    await expect(service.getStatus()).resolves.toMatchObject({ state: 'ready' })
    await expect(service.getInstalledPaths()).resolves.toEqual({
      llamaDir: join(offlineAiRoot, 'bin/runtime'),
      serverExe: join(offlineAiRoot, 'bin/runtime/llama-server.exe'),
      graniteModel: join(offlineAiRoot, 'models/granite.gguf'),
      nomicModel: join(offlineAiRoot, 'models/nomic.gguf'),
    })
  })

  it('reports manifest total bytes', async () => {
    const { service, manifest } = await makeFixture()
    const expectedTotal = manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0)

    await expect(service.getStatus()).resolves.toMatchObject({ totalBytes: expectedTotal })
  })
})
