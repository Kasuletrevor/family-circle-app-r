import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')

function source(path: string): string {
  const fullPath = resolve(root, path)
  expect(existsSync(fullPath)).toBe(true)
  return readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n')
}

const expectedMailEnv = [
  'SEND_EMAILS: ${{ vars.SEND_EMAILS }}',
  'MAIL_API_URL: ${{ vars.MAIL_API_URL }}',
  'MAIL_API_TIMEOUT_MS: ${{ vars.MAIL_API_TIMEOUT_MS }}',
  'MAIL_API_USER: ${{ secrets.MAIL_API_USER }}',
  'MAIL_API_PASSWORD: ${{ secrets.MAIL_API_PASSWORD }}',
]

const trustedSecretGuard = "if: github.event_name != 'pull_request' || (github.event.pull_request.head.repo.full_name == github.repository && github.actor != 'dependabot[bot]')"

describe('mail API CI configuration', () => {
  it('verifies configured repository secrets and variables in desktop CI', () => {
    const workflow = source('.github/workflows/desktop-shell-ci.yml')
    expect(workflow).toContain('name: Verify mail API configuration')
    expect(workflow).toContain(trustedSecretGuard)
    expect(workflow).toContain('node scripts/verify-mail-api-config.mjs')
    for (const entry of expectedMailEnv) expect(workflow).toContain(entry)
  })

  it('generates the temporary demo mail resource from GitHub configuration during Windows packaging', () => {
    const workflow = source('.github/workflows/windows-package.yml')
    expect(workflow).toContain('name: Verify mail API configuration')
    expect(workflow).toContain(trustedSecretGuard)
    expect(workflow).toContain('node scripts/verify-mail-api-config.mjs')

    const buildStart = workflow.indexOf('- name: Build Windows installer')
    expect(buildStart).toBeGreaterThanOrEqual(0)
    const buildBlock = workflow.slice(buildStart, workflow.indexOf('- name:', buildStart + 1))
    expect(buildBlock).toContain('node scripts/write-demo-mail-config.mjs')
    expect(buildBlock).toContain('npm run package:win')
    for (const entry of expectedMailEnv) expect(buildBlock).toContain(entry)
  })

  it('keeps both mail configuration scripts secret-safe', () => {
    const verifier = source('scripts/verify-mail-api-config.mjs')
    expect(verifier).toContain('MAIL_API_USER')
    expect(verifier).toContain('MAIL_API_PASSWORD')
    expect(verifier).toContain('MAIL_API_URL')
    expect(verifier).toContain('MAIL_API_TIMEOUT_MS')
    expect(verifier).not.toMatch(/console\.log\([^)]*(MAIL_API_PASSWORD|MAIL_API_USER)/)
    expect(verifier).toContain('process.exitCode = 1')

    const generator = source('scripts/write-demo-mail-config.mjs')
    expect(generator).toContain("'demo-mail-config.json'")
    expect(generator).toContain("required('MAIL_API_USER')")
    expect(generator).toContain("required('MAIL_API_PASSWORD')")
    expect(generator).not.toMatch(/console\.log\([^)]*(MAIL_API_PASSWORD|MAIL_API_USER|password|user)/i)
  })
})
