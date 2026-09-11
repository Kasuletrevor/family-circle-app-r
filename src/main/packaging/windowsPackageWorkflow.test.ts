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
    expect(source).toContain('npm run package:win')
    expect(source).toContain('npm run verify:package')
    expect(source).toContain('Family-Circle-Setup-*.exe')
  })

  it('publishes every successful installer as an Actions artifact', () => {
    const source = workflow()
    expect(source).toContain('actions/upload-artifact@')
    expect(source).toContain('name: family-circle-windows-installer')
    expect(source).toContain('release/Family-Circle-Setup-*.exe')
  })

  it('publishes version tags to a GitHub Release without server secrets', () => {
    const source = workflow()
    expect(source).toContain("startsWith(github.ref, 'refs/tags/v')")
    expect(source).toContain('contents: write')
    expect(source).toContain('gh release')
    expect(source).not.toMatch(/SERVER_IP|SSH_|scp-action|ssh-action/i)
  })

  it('keeps packaging read-only and grants write permission only to the tag release job', () => {
    const source = workflow()
    expect(source).toContain('permissions:\n  contents: read')
    expect(source).toMatch(/release:\n\s+if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
    expect(source).toMatch(/release:[\s\S]*?permissions:\n\s+contents: write/)
    expect(source).toContain('actions/download-artifact@')
  })

  it('keeps the approved push/tag/base trigger policy and adds Story/voice PR path filters', () => {
    const source = workflow()
    expect(source).toMatch(/push:\n\s+branches:\n\s+- feature\/windows-packaging-release\n\s+tags:\n\s+- 'v\*'/)
    expect(source).not.toMatch(/push:[\s\S]*?branches:[\s\S]*?- main/)
    expect(source).toMatch(/pull_request:\n\s+branches:\n\s+- main/)
    for (const path of [
      "config/offline-voice-manifest.json",
      "third_party/whisper.cpp-LICENSE.txt",
      "src/main/story/**",
      "src/main/voice/**",
      "src/renderer/features/story/**",
      "src/renderer/services/story/**",
      "src/shared/story.ts",
    ]) {
      expect(source).toContain(`- '${path}'`)
    }
  })
})
