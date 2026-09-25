import { describe, expect, it } from 'vitest'
import {
  bumpVersion,
  deriveNextRelease,
  isAlreadyReleased,
  parseConventionalSubject,
  parseSemver,
} from './derive-semantic-release.mjs'

describe('semantic release derivation', () => {
  it.each([
    ['fix: correct invitation authentication', 'fix', 'patch'],
    ['perf(vault): speed up indexing', 'perf', 'patch'],
    ['refactor: simplify Circle client', 'refactor', 'patch'],
    ['chore: refresh packaging tooling', 'chore', 'patch'],
    ['ci: harden release verification', 'ci', 'patch'],
    ['docs: update release guide', 'docs', 'patch'],
    ['feat: add Memories gallery', 'feat', 'minor'],
    ['feat!: replace the local data format', 'feat', 'major'],
    ['fix(circle)!: replace shared identity format', 'fix', 'major'],
    ['feat: BREAKING CHANGE replace sync format', 'feat', 'major'],
  ])('maps %s to %s/%s', (subject, type, impact) => {
    expect(parseConventionalSubject(subject)).toMatchObject({
      eligible: true,
      type,
      impact,
    })
  })

  it.each([
    'random updates',
    'WIP',
    'release: prepare v0.2.0',
    'Feat: wrong case',
    'fix:',
  ])('does not release non-approved subject %s', (subject) => {
    expect(parseConventionalSubject(subject).eligible).toBe(false)
  })

  it.each([
    ['0.1.0', 'patch', '0.1.1'],
    ['0.1.0', 'minor', '0.2.0'],
    ['0.2.2', 'major', '1.0.0'],
    ['1.4.8', 'patch', '1.4.9'],
  ])('bumps %s with %s to %s', (base, impact, expected) => {
    expect(bumpVersion(base, impact)).toBe(expected)
  })

  it('bootstraps the first automatic release as minor when the unreleased range contains Family Tree feat', () => {
    expect(deriveNextRelease({
      baseVersion: '0.1.0',
      subjects: [
        'feat: ship Family Tree, notifications, and Circle switcher (#41)',
        'fix: host Private AI assets on own server + harden downloader',
        'ci: automate semantic versions and release tags (#42)',
        'fix: publish the first semantic release',
      ],
    })).toEqual({ impact: 'minor', version: '0.2.0' })
  })

  it('uses the highest release impact across all commits since the previous tag', () => {
    expect(deriveNextRelease({
      baseVersion: '0.1.0',
      subjects: [
        'fix: remove misleading shell placeholders',
        'feat: ship Family Tree, notifications, and Circle switcher',
        'ci: automate semantic releases',
      ],
    })).toEqual({ impact: 'minor', version: '0.2.0' })
  })

  it('promotes any breaking commit in the unreleased range to a major release', () => {
    expect(deriveNextRelease({
      baseVersion: '0.9.7',
      subjects: [
        'feat: add settings',
        'fix!: replace Circle storage contract',
        'docs: update help',
      ],
    })).toEqual({ impact: 'major', version: '1.0.0' })
  })

  it('treats a retry of an already-tagged HEAD as already released', () => {
    expect(isAlreadyReleased('abc123', 'abc123')).toBe(true)
    expect(isAlreadyReleased('abc123', 'def456')).toBe(false)
    expect(isAlreadyReleased('', 'abc123')).toBe(false)
  })

  it('parses only stable vMAJOR.MINOR.PATCH tags', () => {
    expect(parseSemver('v1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3, version: '1.2.3' })
    expect(parseSemver('1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3, version: '1.2.3' })
    expect(parseSemver('v1.2.3-rc.1')).toBeNull()
  })
})
