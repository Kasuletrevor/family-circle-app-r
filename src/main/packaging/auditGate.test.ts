import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateAudit } from '../../../scripts/audit-gate.mjs'

const repoRoot = resolve(__dirname, '../../..')

function report(...advisories: Array<{ id: string; name: string; severity: string }>) {
  const vulnerabilities: Record<string, unknown> = {}
  for (const advisory of advisories) {
    vulnerabilities[advisory.name] = {
      severity: advisory.severity,
      via: [{ name: advisory.name, title: `${advisory.name} issue`, severity: advisory.severity, url: `https://github.com/advisories/${advisory.id}` }],
    }
  }
  // Packages that only depend on a vulnerable one carry no advisory of their own.
  vulnerabilities['electron-builder'] = { severity: 'high', via: ['app-builder-lib'] }
  return { vulnerabilities }
}

const allowlist = { advisories: [{ id: 'GHSA-ch52-4w7c-c8xp', package: 'http-cache-semantics', reason: 'build-time only', expires: '2026-11-03' }] }

describe('CI audit gate', () => {
  it('passes when every high advisory is allowlisted and not expired', () => {
    const result = evaluateAudit(report({ id: 'GHSA-ch52-4w7c-c8xp', name: 'http-cache-semantics', severity: 'high' }), allowlist, '2026-10-03')
    expect(result.ok).toBe(true)
    expect(result.allowed).toEqual([{ id: 'GHSA-CH52-4W7C-C8XP', name: 'http-cache-semantics', expires: '2026-11-03' }])
  })

  it('still fails on any other high or critical advisory', () => {
    const result = evaluateAudit(report(
      { id: 'GHSA-ch52-4w7c-c8xp', name: 'http-cache-semantics', severity: 'high' },
      { id: 'GHSA-aaaa-bbbb-cccc', name: 'undici', severity: 'critical' },
    ), allowlist, '2026-10-03')
    expect(result.ok).toBe(false)
    expect(result.blocking.map((item) => item.id)).toEqual(['GHSA-AAAA-BBBB-CCCC'])
  })

  it('fails once an allowlist entry expires', () => {
    const result = evaluateAudit(report({ id: 'GHSA-ch52-4w7c-c8xp', name: 'http-cache-semantics', severity: 'high' }), allowlist, '2026-11-04')
    expect(result.ok).toBe(false)
    expect(result.expired).toEqual([{ id: 'GHSA-CH52-4W7C-C8XP', name: 'http-cache-semantics', expires: '2026-11-03' }])
  })

  it('ignores moderate advisories and reports allowlist entries that no longer match', () => {
    const result = evaluateAudit(report({ id: 'GHSA-zzzz-yyyy-xxxx', name: 'left-pad', severity: 'moderate' }), allowlist, '2026-10-03')
    expect(result.ok).toBe(true)
    expect(result.unused).toEqual(['GHSA-CH52-4W7C-C8XP'])
  })

  it('every allowlist entry has a reason and an expiry date', () => {
    const entries = JSON.parse(readFileSync(resolve(repoRoot, 'config/audit-allowlist.json'), 'utf8')).advisories as Array<Record<string, string>>
    for (const entry of entries) {
      expect(entry.id).toMatch(/^GHSA-/)
      expect(entry.reason.length).toBeGreaterThan(40)
      expect(entry.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('is what CI runs instead of a bare npm audit', () => {
    const workflow = readFileSync(resolve(repoRoot, '.github/workflows/desktop-shell-ci.yml'), 'utf8')
    expect(workflow).toContain('node scripts/audit-gate.mjs')
    expect(workflow).not.toContain('npm audit --audit-level=high')
  })
})
