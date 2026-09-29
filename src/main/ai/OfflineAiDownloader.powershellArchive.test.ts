import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PowerShellArchivePort } from './OfflineAiDownloader'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

// Runs the real Windows PowerShell Expand-Archive. The downloader tests inject a fake
// archive port, which is how a broken extraction command once shipped unnoticed.
describe.runIf(process.platform === 'win32')('PowerShellArchivePort on Windows', () => {
  async function makeStagedZip(): Promise<{ root: string; zipPartPath: string }> {
    const root = await mkdtemp(join(tmpdir(), 'family circle archive '))
    roots.push(root)
    const source = join(root, 'source')
    await mkdir(source)
    await writeFile(join(source, 'llama-server.exe'), 'fake runtime')
    const zipPath = join(root, 'runtime.zip')
    const compressed = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Compress-Archive -Path (Join-Path $env:FC_TEST_SOURCE "*") -DestinationPath $env:FC_TEST_ZIP',
    ], { env: { ...process.env, FC_TEST_SOURCE: source, FC_TEST_ZIP: zipPath } })
    expect(compressed.status).toBe(0)

    // The downloader stages archives as "<target>.zip.part", which Expand-Archive rejects by name.
    const zipPartPath = join(root, 'llama-runtime.zip.part')
    await writeFile(zipPartPath, await readFile(zipPath))
    return { root, zipPartPath }
  }

  it('extracts a staged .zip.part archive from a path containing spaces', async () => {
    const { root, zipPartPath } = await makeStagedZip()
    const destination = join(root, 'bin', 'llama runtime')

    await new PowerShellArchivePort().extractZip(zipPartPath, destination)

    await expect(readFile(join(destination, 'llama-server.exe'), 'utf8')).resolves.toBe('fake runtime')
    // The staged file keeps its original name so the downloader can remove it afterwards.
    expect(existsSync(zipPartPath)).toBe(true)
  }, 60_000)

  it('rejects with extract-failed for a corrupt archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'family-circle-archive-'))
    roots.push(root)
    const zipPartPath = join(root, 'broken.zip.part')
    await writeFile(zipPartPath, 'not a zip')

    await expect(new PowerShellArchivePort().extractZip(zipPartPath, join(root, 'out')))
      .rejects.toMatchObject({ code: 'extract-failed' })
    expect(existsSync(zipPartPath)).toBe(true)
  }, 60_000)
})
