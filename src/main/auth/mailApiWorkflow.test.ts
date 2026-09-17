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

  it('verifies the same mail configuration before Windows packaging without exposing it to build steps', () => {
    const workflow = source('.github/workflows/windows-package.yml')
    expect(workflow).toContain('name: Verify mail API configuration')
    expect(workflow).toContain(trustedSecretGuard)
    expect(workflow).toContain('node scripts/verify-mail-api-config.mjs')
    for (const entry of expectedMailEnv) expect(workflow).toContain(entry)

    const buildStart = workflow.indexOf('- name: Build Windows installer')
    const verifyStart = workflow.indexOf('- name: Verify mail API configuration')
    expect(verifyStart).toBeGreaterThanOrEqual(0)
    expect(buildStart).toBeGreaterThan(verifyStart)
    const buildBlock = workflow.slice(buildStart, workflow.indexOf('- name:', buildStart + 1))
    expect(buildBlock).not.toMatch(/MAIL_API_|SEND_EMAILS|secrets\./)
  })

  it('keeps the mail verifier secret-safe and rejects incomplete configuration', () => {
    const verifier = source('scripts/verify-mail-api-config.mjs')
    expect(verifier).toContain('MAIL_API_USER')
    expect(verifier).toContain('MAIL_API_PASSWORD')
    expect(verifier).toContain('MAIL_API_URL')
    expect(verifier).toContain('MAIL_API_TIMEOUT_MS')
    expect(verifier).not.toMatch(/console\.log\([^)]*(MAIL_API_PASSWORD|MAIL_API_USER)/)
    expect(verifier).toContain('process.exitCode = 1')
  })
})
