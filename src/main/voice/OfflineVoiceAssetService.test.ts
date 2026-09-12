import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PINNED_VOICE_MODEL,
  PINNED_VOICE_RUNTIME,
  VOICE_PACK_VERSION,
  parseVoiceManifest,
} from './voiceModels'
import { OfflineVoiceAssetService } from './OfflineVoiceAssetService'

const roots: string[] = []
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'family-circle-voice-assets-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const repoRoot = resolve(__dirname, '../../..')
const manifestPath = resolve(repoRoot, 'config/offline-voice-manifest.json')

describe('OfflineVoiceAssetService', () => {
  it('accepts only the approved pinned Whisper runtime and base model manifest', async () => {
    const manifest = parseVoiceManifest(await readFile(manifestPath, 'utf8'))

    expect(manifest.version).toBe(VOICE_PACK_VERSION)
    expect(manifest.files).toEqual([PINNED_VOICE_RUNTIME, PINNED_VOICE_MODEL])
    expect(PINNED_VOICE_RUNTIME).toMatchObject({
      url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip',
      sizeBytes: 7_982_101,
      sha256: '7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539',
      targetPath: 'runtime/whisper-v1.9.1-win-x64',
      extract: true,
      required: true,
    })
    expect(PINNED_VOICE_MODEL).toMatchObject({
      url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
      sizeBytes: 147_951_465,
      sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
      targetPath: 'models/ggml-base.bin',
      extract: false,
      required: true,
    })
  })

  it('rejects changed URLs, sizes, zero hashes, extra files, and altered target paths', async () => {
    const original = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string; files: Array<Record<string, unknown>> }
    const variants = [
      { ...original, files: original.files.map((item, index) => index === 0 ? { ...item, url: 'https://example.invalid/runtime.zip' } : item) },
      { ...original, files: original.files.map((item, index) => index === 1 ? { ...item, sizeBytes: 1 } : item) },
      { ...original, files: original.files.map((item, index) => index === 0 ? { ...item, sha256: '0'.repeat(64) } : item) },
      { ...original, files: [...original.files, { ...original.files[1], name: 'extra' }] },
      { ...original, files: original.files.map((item, index) => index === 0 ? { ...item, targetPath: '../escape' } : item) },
    ]

    for (const variant of variants) {
      expect(() => parseVoiceManifest(JSON.stringify(variant))).toThrow('Invalid offline voice manifest')
    }
  })

  it('reports repair_required when a matching marker exists but installed assets are missing', async () => {
    const root = await tempRoot()
    const voiceRoot = join(root, 'offline-voice')
    await mkdir(voiceRoot, { recursive: true })
    await writeFile(join(voiceRoot, 'installed-version.json'), JSON.stringify({ version: VOICE_PACK_VERSION }), 'utf8')

    const service = new OfflineVoiceAssetService({ userDataPath: root, manifestPath })
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'repair_required',
      message: 'Offline voice needs repair',
    })
    await expect(service.getInstalledPaths()).resolves.toBeNull()
  })

  it('uses OfflineAiDownloader semantics but exposes only voice-safe progress and failure messages', async () => {
    const root = await tempRoot()
    const downloadAll = vi.fn(async (_manifest, requestedRoot: string, onProgress?: (progress: any) => void) => {
      expect(requestedRoot).toBe(join(root, 'offline-voice'))
      onProgress?.({
        state: 'downloading', phase: 'downloading', percent: 25,
        fileIndex: 1, fileCount: 2, fileName: 'Whisper runtime',
        bytesDownloaded: 10, totalBytes: 100, fileBytesDownloaded: 10, fileSizeBytes: 40,
        message: 'Downloading Private AI',
      })
      return { paused: false }
    })
    const progress: any[] = []
    const service = new OfflineVoiceAssetService({
      userDataPath: root,
      manifestPath,
      downloader: { downloadAll, pause: vi.fn() },
      verifyInstalled: async () => ({
        runtimeDir: join(root, 'offline-voice', PINNED_VOICE_RUNTIME.targetPath),
        executable: join(root, 'offline-voice', PINNED_VOICE_RUNTIME.targetPath, 'Release', 'whisper-cli.exe'),
        model: join(root, 'offline-voice', PINNED_VOICE_MODEL.targetPath),
      }),
    })

    const result = await service.startSetup((event) => progress.push(event))
    expect(downloadAll).toHaveBeenCalledTimes(1)
    expect(progress[0]?.message).toBe('Downloading offline voice')
    expect(result).toMatchObject({ state: 'ready', message: 'Offline voice is ready' })
    expect(JSON.stringify(progress)).not.toMatch(/Private AI|stderr|https?:\/\//i)
  })

  it('maps downloader errors to a stable safe failure and supports pause/repair without leaking internals', async () => {
    const root = await tempRoot()
    const pause = vi.fn()
    const downloadAll = vi.fn().mockRejectedValue(new Error('C:\\secret\\runtime stderr connection refused'))
    const service = new OfflineVoiceAssetService({
      userDataPath: root,
      manifestPath,
      downloader: { downloadAll, pause },
    })

    await expect(service.startSetup()).resolves.toMatchObject({ state: 'failed', message: 'Offline voice setup failed' })
    expect(JSON.stringify(await service.getStatus())).not.toMatch(/secret|stderr|connection refused/i)
    service.pauseSetup()
    expect(pause).toHaveBeenCalledTimes(1)

    downloadAll.mockResolvedValueOnce({ paused: true })
    await service.repair()
    expect(downloadAll).toHaveBeenCalledTimes(2)
  })
})
