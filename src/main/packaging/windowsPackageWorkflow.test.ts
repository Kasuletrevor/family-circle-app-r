import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')
const workflowPath = resolve(root, '.github/workflows/windows-package.yml')

function workflow(): string {
  expect(existsSync(workflowPath)).toBe(true)
  return readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n')
}

describe('Windows packaging workflow', () => {
  it('builds and verifies the installer on a real Windows runner', () => {
    const source = workflow()
    expect(source).toContain('runs-on: windows-latest')
    expect(source).toContain('npm ci --no-audit')
    expect(source).toContain('npm run check')
    expect(source).toContain('node scripts/write-demo-mail-config.mjs')
    expect(source).toContain('node scripts/write-demo-circle-config.mjs')
    expect(source).toContain('npm run package:win')
    expect(source).toContain('npm run verify:package')
    expect(source).toContain('Family-Circle-Setup-*.exe')
  })

  it('generates Circle config in a dedicated secret-bearing step before packaging', () => {
    const source = workflow()
    const circleStart = source.indexOf('- name: Generate demo Circle config')
    expect(circleStart).toBeGreaterThanOrEqual(0)
    const circleBlock = source.slice(circleStart, source.indexOf('- name:', circleStart + 1))
    expect(circleBlock).toContain('CIRCLE_API_URL: ${{ vars.CIRCLE_API_URL }}')
    expect(circleBlock).toContain('CIRCLE_API_KEY: ${{ secrets.CIRCLE_API_KEY }}')
    expect(circleBlock).toContain('node scripts/write-demo-circle-config.mjs')

    const buildStart = source.indexOf('- name: Build Windows installer')
    expect(buildStart).toBeGreaterThanOrEqual(0)
    const buildBlock = source.slice(buildStart, source.indexOf('- name:', buildStart + 1))
    expect(buildBlock).toContain('npm run package:win')
    expect(buildBlock).not.toContain('CIRCLE_API_KEY')
  })

  it('publishes every successful installer as an Actions artifact', () => {
    const source = workflow()
    expect(source).toContain('actions/upload-artifact@')
    expect(source).toContain('name: family-circle-windows-installer')
    expect(source).toContain('release/Family-Circle-Setup-*.exe')
  })

  it('publishes version tags to a GitHub Release without coupling that job to server secrets', () => {
    const source = workflow()
    const releaseStart = source.indexOf('  release:\n')
    const deployStart = source.indexOf('  deploy-demo:\n')
    expect(releaseStart).toBeGreaterThanOrEqual(0)
    expect(deployStart).toBeGreaterThan(releaseStart)
    const releaseBlock = source.slice(releaseStart, deployStart)

    expect(releaseBlock).toContain("startsWith(github.ref, 'refs/tags/v')")
    expect(releaseBlock).toContain('contents: write')
    expect(releaseBlock).toContain('gh release create $tag --verify-tag')
    expect(releaseBlock).toContain('Get-FileHash -Path $installer -Algorithm SHA256')
    expect(releaseBlock).toContain('$checksumPath = "$installer.sha256"')
    expect(releaseBlock).toContain('gh release upload $tag $installer $checksumPath --clobber')
    expect(releaseBlock).not.toMatch(/DEV_SSH_|SERVER_IP|scp-action|ssh-action/i)
  })

  it('rejects unsafe or mismatched release tags before packaging', () => {
    const source = workflow()
    const validateStart = source.indexOf('- name: Validate release tag')
    expect(validateStart).toBeGreaterThanOrEqual(0)
    const validateBlock = source.slice(validateStart, source.indexOf('- name:', validateStart + 1))

    expect(source).toContain('fetch-depth: 0')
    expect(validateBlock).toContain("^v[0-9]+\\.[0-9]+\\.[0-9]+$")
    expect(validateBlock).toContain('$expectedTag = "v$packageVersion"')
    expect(validateBlock).toContain('git merge-base --is-ancestor $env:GITHUB_SHA origin/main')
    expect(validateBlock).toContain('Release tags must point to merged main history')
    expect(validateBlock).toContain('must be newer than existing stable tag')
  })

  it('keeps content writes isolated to release while allowing package status reporting', () => {
    const source = workflow()
    expect(source).toContain('permissions:\n  contents: read')
    expect(source).toMatch(/package:[\s\S]*?permissions:\n\s+contents: read\n\s+statuses: write/)
    expect(source).toContain('context=demo-package-stage:$stage')
    expect(source).toMatch(/release:\n\s+if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
    expect(source).toMatch(/release:[\s\S]*?permissions:\n\s+contents: write/)
    expect(source).toContain('actions/download-artifact@')
  })

  it('packages relevant main pushes for demo deployment while preserving tag and PR triggers', () => {
    const source = workflow()
    const pushStart = source.indexOf('  push:\n')
    const pullStart = source.indexOf('  pull_request:\n')
    expect(pushStart).toBeGreaterThanOrEqual(0)
    expect(pullStart).toBeGreaterThan(pushStart)
    const pushBlock = source.slice(pushStart, pullStart)

    expect(pushBlock).toContain('branches:\n      - main\n      - feature/windows-packaging-release')
    expect(pushBlock).toContain("tags:\n      - 'v*'")
    expect(pushBlock).toContain("      - 'src/**'")
    expect(pushBlock).toContain("      - 'public/**'")
    expect(pushBlock).toContain("      - 'scripts/**'")
    expect(source).toMatch(/pull_request:\n\s+branches:\n\s+- main/)

    for (const path of [
      "config/offline-voice-manifest.json",
      "third_party/whisper.cpp-LICENSE.txt",
      "scripts/write-demo-mail-config.mjs",
      "scripts/write-demo-circle-config.mjs",
      "src/main/auth/**",
      "src/main/circle/**",
      "src/main/story/**",
      "src/main/voice/**",
      "src/renderer/features/story/**",
      "src/renderer/services/story/**",
      "src/renderer/design-system/**",
      "src/renderer/assets/**",
      "src/shared/story.ts",
    ]) {
      expect(source).toContain(`- '${path}'`)
    }
  })
})