// CI security gate: fails on any high or critical npm advisory, except ones listed in
// config/audit-allowlist.json with a reason and an expiry date. Expired entries fail.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BLOCKING = new Set(['high', 'critical'])

export function advisoryId(advisory) {
  return String(advisory?.url ?? '').match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0]?.toUpperCase() ?? `npm-${advisory?.source ?? 'unknown'}`
}

/** Returns what blocks the build and which allowlist entries were used, expired or unused. */
export function evaluateAudit(report, allowlist, today = new Date().toISOString().slice(0, 10)) {
  const advisories = new Map()
  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue
      advisories.set(advisoryId(via), via)
    }
  }

  const entries = new Map((allowlist?.advisories ?? []).map((entry) => [String(entry.id).toUpperCase(), entry]))
  const blocking = []
  const allowed = []
  const expired = []
  for (const [id, advisory] of advisories) {
    const entry = entries.get(id)
    if (!entry) {
      blocking.push({ id, name: advisory.name, title: advisory.title, severity: advisory.severity })
    } else if (!entry.expires || String(entry.expires) < today) {
      expired.push({ id, name: advisory.name, expires: entry.expires ?? null })
    } else {
      allowed.push({ id, name: advisory.name, expires: entry.expires })
    }
  }
  const unused = [...entries.keys()].filter((id) => !advisories.has(id))
  return { blocking, allowed, expired, unused, ok: blocking.length === 0 && expired.length === 0 }
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const allowlist = JSON.parse(readFileSync(new URL('../config/audit-allowlist.json', import.meta.url), 'utf8'))
  const audit = spawnSync('npm', ['audit', '--json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' })
  if (audit.stderr) process.stderr.write(audit.stderr)

  let report
  try {
    report = JSON.parse(audit.stdout)
  } catch {
    // Keep npm's own wording so the CI retry loop recognises network problems.
    console.error(audit.stdout || 'audit endpoint returned an error')
    process.exit(2)
  }
  if (report.error) {
    console.error(`audit endpoint returned an error: ${report.error.summary ?? report.error.code ?? 'unknown'}`)
    process.exit(2)
  }

  const result = evaluateAudit(report, allowlist)
  for (const item of result.allowed) console.log(`Allowed until ${item.expires}: ${item.id} (${item.name}) — see config/audit-allowlist.json`)
  for (const id of result.unused) console.log(`::notice::Allowlist entry ${id} no longer matches any advisory; remove it.`)
  for (const item of result.expired) console.error(`::error::Allowlist entry for ${item.id} (${item.name}) expired on ${item.expires}. Re-check the advisory and renew or fix it.`)
  for (const item of result.blocking) console.error(`::error::${item.severity} advisory ${item.id} in ${item.name}: ${item.title}`)
  if (!result.ok) process.exit(1)
  console.log('No blocking npm advisories.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
