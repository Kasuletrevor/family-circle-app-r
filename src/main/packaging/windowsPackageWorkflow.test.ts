import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')
const workflowPath = resolve(root, '.github/workflows/windows-package.yml')
const desktopWorkflowPath = resolve(root, '.github/workflows/desktop-shell-ci.yml')

function workflow(): string {
  expect(existsSync(workflowPath)).toBe(true)
  return readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n')
}

function desktopWorkflow(): string {
  expect(existsSync(desktopWorkflowPath)).toBe(true)
  return readFileSync(desktopWorkflowPath, 'utf8').replace(/\r\n/g, '\n')
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

  it('derives the semantic version early but applies it only after application verification', () => {
    const source = workflow()
    const deriveStart = source.indexOf('- name: Derive semantic release version')
    const applyStart = source.indexOf('- name: Apply semantic version to package workspace')
    const installStart = source.indexOf('- name: Install dependencies')
    const verifyStart = source.indexOf('- name: Verify application')

    expect(source).toContain('fetch-depth: 0')
    expect(deriveStart).toBeGreaterThanOrEqual(0)
    expect(installStart).toBeGreaterThan(deriveStart)
    expect(verifyStart).toBeGreaterThan(installStart)
    expect(applyStart).toBeGreaterThan(verifyStart)
    expect(source).toContain('node scripts/derive-semantic-release.mjs')
    expect(source).toContain("steps.semantic_release.outputs.release_eligible == 'true'")
    expect(source).toContain('npm version $version --no-git-tag-version --allow-same-version')
    expect(source).toContain('release_version: ${{ steps.semantic_release.outputs.release_version }}')
    expect(source).toContain('release_tag: ${{ steps.semantic_release.outputs.release_tag }}')
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

  it('recovers a publicly verified release before calculating the next main version', () => {
    const source = workflow()
    const recoveryStart = source.indexOf('  recover-pending-release:\n')
    const packageStart = source.indexOf('  package:\n')

    expect(recoveryStart).toBeGreaterThanOrEqual(0)
    expect(packageStart).toBeGreaterThan(recoveryStart)
    const recoveryBlock = source.slice(recoveryStart, packageStart)

    expect(recoveryBlock).toContain("github.ref == 'refs/heads/main'")
    expect(recoveryBlock).toContain('contents: write')
    expect(recoveryBlock).toContain('actions/checkout@v7')
    expect(recoveryBlock).toContain('fetch-depth: 0')
    expect(recoveryBlock).toContain('electron-releases/demo/current.json')
    expect(recoveryBlock).toContain('Recoverable installer checksum mismatch')
    expect(recoveryBlock).toContain('refs/tags/$tag')
    expect(recoveryBlock).toContain('gh release create "$tag"')
    expect(source).toContain('needs: recover-pending-release')
    expect(source).toContain("needs.recover-pending-release.result == 'success'")
    expect(source).toContain("needs.recover-pending-release.result == 'skipped'")
  })

  it('creates the immutable tag and GitHub Release only after verified server deployment', () => {
    const source = workflow()
    const finalizeStart = source.indexOf('  finalize-release:\n')
    const reportStart = source.indexOf('  report-demo-status:\n')
    expect(finalizeStart).toBeGreaterThanOrEqual(0)
    expect(reportStart).toBeGreaterThan(finalizeStart)
    const finalizeBlock = source.slice(finalizeStart, reportStart)

    expect(finalizeBlock).toContain('needs:\n      - package\n      - deploy-demo')
    expect(finalizeBlock).toContain("needs.deploy-demo.result == 'success'")
    expect(finalizeBlock).toContain('contents: write')
    expect(finalizeBlock).toContain('actions/download-artifact@v8')
    expect(finalizeBlock).toContain('git/ref/tags/$RELEASE_TAG')
    expect(finalizeBlock).toContain('if existing_sha="$(gh api')
    expect(finalizeBlock).toContain('refs/tags/$RELEASE_TAG')
    expect(finalizeBlock).toContain('gh release create "$RELEASE_TAG"')
    expect(finalizeBlock).toContain('--generate-notes')
    expect(finalizeBlock).toContain('semantic-release:published')
    expect(finalizeBlock).not.toMatch(/DEV_SSH_|SERVER_IP|scp-action|ssh-action/i)
  })

  it('requires approved Conventional Commit titles on pull requests', () => {
    const source = desktopWorkflow()
    expect(source).toContain('name: Validate Conventional Commit PR title')
    expect(source).toContain('PR_TITLE: ${{ github.event.pull_request.title }}')
    expect(source).toContain('feat|fix|perf|refactor|chore|ci|docs)')
    expect(source).toContain('PR title must use an approved Conventional Commit type')
  })

  it('keeps repository writes isolated to post-deploy release finalization', () => {
    const source = workflow()
    expect(source).toContain('permissions:\n  contents: read')
    expect(source).toMatch(/package:[\s\S]*?permissions:\n\s+contents: read\n\s+statuses: write/)
    expect(source).toContain('context=demo-package-stage:$stage')
    expect(source).toMatch(/finalize-release:[\s\S]*?permissions:\n\s+contents: write\n\s+statuses: write/)
    expect(source).toContain('actions/download-artifact@')
    expect(source).not.toContain("if: startsWith(github.ref, 'refs/tags/v')")
  })

  it('packages relevant main pushes and does not rebuild when automation creates a tag', () => {
    const source = workflow()
    const pushStart = source.indexOf('  push:\n')
    const pullStart = source.indexOf('  pull_request:\n')
    expect(pushStart).toBeGreaterThanOrEqual(0)
    expect(pullStart).toBeGreaterThan(pushStart)
    const pushBlock = source.slice(pushStart, pullStart)

    expect(pushBlock).toContain('branches:\n      - main\n      - feature/windows-packaging-release')
    expect(pushBlock).not.toContain("tags:\n      - 'v*'")
    expect(pushBlock).toContain("      - 'src/**'")
    expect(pushBlock).toContain("      - 'public/**'")
    expect(pushBlock).toContain("      - 'scripts/**'")
    expect(source).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
    expect(source).toMatch(/pull_request:\n\s+branches:\n\s+- main/)
    expect(source).toContain("scripts/derive-semantic-release*.mjs")

    for (const path of [
      'config/offline-voice-manifest.json',
      'third_party/whisper.cpp-LICENSE.txt',
      'scripts/write-demo-mail-config.mjs',
      'scripts/write-demo-circle-config.mjs',
      'src/main/auth/**',
      'src/main/circle/**',
      'src/main/story/**',
      'src/main/voice/**',
      'src/renderer/features/story/**',
      'src/renderer/services/story/**',
      'src/renderer/design-system/**',
      'src/renderer/assets/**',
      'src/shared/story.ts',
    ]) {
      expect(source).toContain(`- '${path}'`)
    }
  })

  it('makes aggregate deployment status depend on semantic release finalization', () => {
    const source = workflow()
    const reportStart = source.indexOf('  report-demo-status:\n')
    const reportBlock = source.slice(reportStart)
    expect(reportBlock).toContain('needs:\n      - package\n      - deploy-demo\n      - finalize-release')
    expect(reportBlock).toContain('FINALIZE_RESULT: ${{ needs.finalize-release.result }}')
    expect(reportBlock).toContain('semantic tag/release failed')
    expect(reportBlock).toContain('deployment and semantic release verified')
  })
})
