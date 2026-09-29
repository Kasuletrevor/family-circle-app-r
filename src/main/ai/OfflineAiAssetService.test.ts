import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
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
  const qwenBytes = 'qwen-test-bytes'
  const nomicBytes = 'nomic-test-bytes'
  const runtimeZipBytes = 'runtime-zip-test-bytes'
  const manifest: OfflineAiManifest = {
    version: 'test-2',
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
        name: 'AI answers',
        type: 'model',
        url: 'https://example.invalid/qwen.gguf',
        targetPath: 'models/qwen.gguf',
        sha256: sha256(qwenBytes),
        sizeBytes: Buffer.byteLength(qwenBytes),
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
    await write('models/qwen.gguf', qwenBytes)
    await write('models/nomic.gguf', nomicBytes)
    await writeMarker()
  }

  return { service, manifest, offlineAiRoot, downloader, write, writeMarker, writeValidInstalledAssets }
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
    await write(`.staging/${manifest.version}/models/qwen.gguf.part`, 'qwen-test-bytes')

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

  it('reports ready only after Qwen, Nomic, and the runtime verify', async () => {
    const { service, offlineAiRoot, writeValidInstalledAssets } = await makeFixture()
    await writeValidInstalledAssets()

    await expect(service.getStatus()).resolves.toMatchObject({ state: 'ready' })
    await expect(service.getInstalledPaths()).resolves.toEqual({
      llamaDir: join(offlineAiRoot, 'bin/runtime'),
      serverExe: join(offlineAiRoot, 'bin/runtime/llama-server.exe'),
      generationModel: join(offlineAiRoot, 'models/qwen.gguf'),
      nomicModel: join(offlineAiRoot, 'models/nomic.gguf'),
    })
  })

  it('removes installed Private AI assets and returns to not_installed', async () => {
    const { service, downloader, writeValidInstalledAssets } = await makeFixture()
    await writeValidInstalledAssets()
    await expect(service.getStatus()).resolves.toMatchObject({ state: 'ready' })

    await expect(service.remove()).resolves.toMatchObject({ state: 'not_installed' })
    expect(downloader.pause).toHaveBeenCalledTimes(1)
    await expect(service.getInstalledPaths()).resolves.toBeNull()
  })

  it('reports manifest total bytes', async () => {
    const { service, manifest } = await makeFixture()
    const expectedTotal = manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0)

    await expect(service.getStatus()).resolves.toMatchObject({ totalBytes: expectedTotal })
  })

  it('reports only the bytes a setup or repair still needs to download', async () => {
    const { service, manifest, write, writeMarker } = await makeFixture()
    const [engine, answers, search] = manifest.files
    const fullSize = engine!.sizeBytes + answers!.sizeBytes + search!.sizeBytes

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'not_installed',
      installSizeBytes: fullSize,
      pendingDownloadBytes: fullSize,
    })

    // Models kept from an older install; only the engine is missing (an engine upgrade).
    await write('models/qwen.gguf', 'qwen-test-bytes')
    await write('models/nomic.gguf', 'nomic-test-bytes')
    await write('installed-version.json', JSON.stringify({ version: 'test-1' }))
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'repair_required',
      installSizeBytes: fullSize,
      pendingDownloadBytes: engine!.sizeBytes,
    })

    await write('bin/runtime/llama-server.exe', 'fake executable')
    await writeMarker()
    await expect(service.getStatus()).resolves.toMatchObject({ state: 'ready', pendingDownloadBytes: 0 })
  })

  it('removes engines, models and staging left over from older manifests once Private AI is ready', async () => {
    const { service, offlineAiRoot, write, writeValidInstalledAssets } = await makeFixture()
    await writeValidInstalledAssets()
    await write('bin/llama-b8772-bin-win-cpu-x64/llama-server.exe', 'old engine')
    await write('models/granite-4.0-h-micro.gguf', 'old model')
    await write('.staging/test-1/models/qwen.gguf.part', 'old partial')
    await write('.staging/test-2/models/nomic.gguf.part', 'current partial')

    await expect(service.getStatus()).resolves.toMatchObject({ state: 'ready' })

    const exists = async (relativePath: string) => stat(join(offlineAiRoot, relativePath)).then(() => true, () => false)
    await vi.waitFor(async () => expect(await exists('bin/llama-b8772-bin-win-cpu-x64')).toBe(false))
    expect(await exists('models/granite-4.0-h-micro.gguf')).toBe(false)
    expect(await exists('.staging/test-1')).toBe(false)
    // Current assets, the current staging version and the marker are kept.
    expect(await exists('bin/runtime/llama-server.exe')).toBe(true)
    expect(await exists('models/qwen.gguf')).toBe(true)
    expect(await exists('models/nomic.gguf')).toBe(true)
    expect(await exists('.staging/test-2')).toBe(true)
    expect(await exists('installed-version.json')).toBe(true)
  })

  it('cleans up leftovers after a successful setup', async () => {
    const { service, offlineAiRoot, write, downloader, manifest } = await makeFixture()
    await write('bin/llama-b8772-bin-win-cpu-x64/llama-server.exe', 'old engine')
    downloader.downloadAll.mockImplementation(async () => {
      await write('bin/runtime/llama-server.exe', 'fake executable')
      await write('models/qwen.gguf', 'qwen-test-bytes')
      await write('models/nomic.gguf', 'nomic-test-bytes')
      return { paused: false }
    })

    await expect(service.startSetup()).resolves.toMatchObject({ state: 'ready' })
    expect(manifest.version).toBe('test-2')
    await expect(stat(join(offlineAiRoot, 'bin/llama-b8772-bin-win-cpu-x64'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(offlineAiRoot, 'bin/runtime/llama-server.exe'))).resolves.toBeTruthy()
  })
})
