#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const APPROVED_TYPES = new Set(['feat', 'fix', 'perf', 'refactor', 'chore', 'ci', 'docs'])
const IMPACT_ORDER = { patch: 1, minor: 2, major: 3 }

export function parseSemver(value) {
  const match = String(value ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    version: `${match[1]}.${match[2]}.${match[3]}`,
  }
}

export function compareSemver(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

export function parseConventionalSubject(subject) {
  const title = String(subject ?? '').trim()
  const match = title.match(/^([a-z][a-z0-9_-]*)(?:\([^)]+\))?(!)?:\s+(.+)$/)
  if (!match || !APPROVED_TYPES.has(match[1])) {
    return { eligible: false, type: null, impact: null, title }
  }

  const type = match[1]
  const breaking = Boolean(match[2]) || /BREAKING(?:[ -])CHANGE/i.test(title)
  const impact = breaking ? 'major' : type === 'feat' ? 'minor' : 'patch'
  return { eligible: true, type, impact, title }
}

export function highestImpact(impacts) {
  let highest = null
  for (const impact of impacts) {
    if (!impact || !(impact in IMPACT_ORDER)) continue
    if (!highest || IMPACT_ORDER[impact] > IMPACT_ORDER[highest]) highest = impact
  }
  return highest
}

export function bumpVersion(baseVersion, impact) {
  const parsed = parseSemver(baseVersion)
  if (!parsed) throw new Error(`Invalid base version: ${baseVersion}`)

  if (impact === 'major') return `${parsed.major + 1}.0.0`
  if (impact === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`
  if (impact === 'patch') return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
  throw new Error(`Unsupported semantic impact: ${impact}`)
}

export function deriveNextRelease({ baseVersion, subjects }) {
  const parsed = subjects.map(parseConventionalSubject)
  const impacts = parsed.filter((entry) => entry.eligible).map((entry) => entry.impact)
  const impact = highestImpact(impacts)
  if (!impact) return null
  return { impact, version: bumpVersion(baseVersion, impact) }
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function stableMergedTags() {
  const raw = git(['tag', '--merged', 'HEAD', '--list', 'v*'])
  if (!raw) return []
  return raw
    .split(/\r?\n/)
    .map((tag) => ({ tag, parsed: parseSemver(tag) }))
    .filter((entry) => entry.parsed)
    .sort((a, b) => compareSemver(a.parsed, b.parsed))
}

function writeOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT
  if (output) {
    appendFileSync(output, `${name}=${value}\n`, 'utf8')
  } else {
    process.stdout.write(`${name}=${value}\n`)
  }
}

async function main() {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
  const packageVersion = String(packageJson.version ?? '').trim()
  if (!parseSemver(packageVersion)) throw new Error(`package.json has invalid version '${packageVersion}'`)

  const subject = git(['log', '-1', '--format=%s', 'HEAD'])
  const current = parseConventionalSubject(subject)
  const tags = stableMergedTags()
  const latest = tags.at(-1) ?? null

  const baseVersion = latest?.parsed.version ?? packageVersion
  const baseTag = latest?.tag ?? ''
  const subjects = latest
    ? git(['log', '--reverse', '--format=%s', `${latest.tag}..HEAD`]).split(/\r?\n/).filter(Boolean)
    : [subject]

  if (!current.eligible) {
    const output = {
      release_eligible: 'false',
      release_type: '',
      release_impact: '',
      release_version: packageVersion,
      release_tag: '',
      release_base_tag: baseTag,
      release_title_b64: Buffer.from(subject, 'utf8').toString('base64'),
    }
    for (const [name, value] of Object.entries(output)) writeOutput(name, value)
    process.stdout.write(`Semantic release skipped: '${subject}' is not an approved Conventional Commit.\n`)
    return
  }

  const next = deriveNextRelease({ baseVersion, subjects })
  if (!next) throw new Error('Could not derive semantic release impact from eligible commits')

  const tag = `v${next.version}`
  const output = {
    release_eligible: 'true',
    release_type: current.type,
    release_impact: next.impact,
    release_version: next.version,
    release_tag: tag,
    release_base_tag: baseTag,
    release_title_b64: Buffer.from(subject, 'utf8').toString('base64'),
  }
  for (const [name, value] of Object.entries(output)) writeOutput(name, value)

  process.stdout.write(
    `Semantic release: ${baseTag || `package@${baseVersion}`} -> ${tag} (${next.impact}) from '${subject}'.\n`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
