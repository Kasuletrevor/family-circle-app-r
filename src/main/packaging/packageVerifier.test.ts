import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')
const verifier = resolve(root, 'scripts/verify-package.mjs')
const tempDirs: string[] = []

function tempReleaseDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'family-circle-release-'))
  tempDirs.push(dir)
  return dir
}

function runVerifier(...args: string[]) {
  return spawnSync(process.execPath, [verifier, ...args], {
    cwd: root,
    encoding: 'utf8',
  })
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Windows package verifier', () => {
  it('verifies the repository packaging contract without requiring an artifact', () => {
    const result = runVerifier('--config-only')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Packaging configuration verified')
  })

  it('accepts exactly one expected Windows installer', () => {
    const releaseDir = tempReleaseDir()
    writeFileSync(resolve(releaseDir, 'Family-Circle-Setup-0.1.0.exe'), 'fake installer')

    const result = runVerifier('--release-dir', releaseDir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Family-Circle-Setup-0.1.0.exe')
  })

  it('fails when the Windows installer is missing or ambiguous', () => {
    const releaseDir = tempReleaseDir()
    let result = runVerifier('--release-dir', releaseDir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Expected exactly one Windows installer')

    writeFileSync(resolve(releaseDir, 'Family-Circle-Setup-0.1.0.exe'), 'one')
    writeFileSync(resolve(releaseDir, 'Family-Circle-Setup-0.1.1.exe'), 'two')
    result = runVerifier('--release-dir', releaseDir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Expected exactly one Windows installer')
  })
})
