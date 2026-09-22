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

  it('passes Circle API URL/key into the trusted demo packaging step', () => {
    const source = workflow()
    const buildStart = source.indexOf('- name: Build Windows installer')
    expect(buildStart).toBeGreaterThanOrEqual(0)
    const buildBlock = source.slice(buildStart, source.indexOf('- name:', buildStart + 1))
    expect(buildBlock).toContain('CIRCLE_API_URL: ${{ vars.CIRCLE_API_URL }}')
    expect(buildBlock).toContain('CIRCLE_API_KEY: ${{ secrets.CIRCLE_API_KEY }}')
    expect(buildBlock).toContain('node scripts/write-demo-circle-config.mjs')
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
    expect(releaseBlock).toContain('gh release')
    expect(releaseBlock).not.toMatch(/DEV_SSH_|SERVER_IP|scp-action|ssh-action/i)
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