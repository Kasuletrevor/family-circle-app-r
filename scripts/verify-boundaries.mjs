import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const rendererRoot = join(root, 'src', 'renderer')
const mainRoot = join(root, 'src', 'main')
const sharedDesktopApiPath = join(root, 'src', 'shared', 'desktopApi.ts')
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.html'])
const legacyAdapterPath = 'src/main/circle/LegacyCircleAuthAdapter.ts'
const desktopCircleClientPath = 'src/renderer/services/circle/DesktopCircleClient.ts'
const mockCircleClientPath = 'src/renderer/services/circle/MockCircleClient.ts'

const rendererRules = [
  { name: 'renderer token storage through localStorage', pattern: /\blocalStorage\b[^\n]*\btoken\b/gi },
  { name: 'renderer token storage through sessionStorage', pattern: /\bsessionStorage\b[^\n]*\btoken\b/gi },
  { name: 'renderer token getter', pattern: /\bgetToken\s*\(/g },
  { name: 'renderer token decoder', pattern: /\bdecodeToken\s*\(/g },
  { name: 'legacy shared API-key header', pattern: /X-Kin-Keepers-Key/g },
  { name: 'Circle API-key configuration', pattern: /\bCIRCLE_API_KEY\b/g },
  { name: 'Circle API URL configuration', pattern: /\bCIRCLE_API_URL\b/g },
  { name: 'legacy shared API key', pattern: /\bP2P_API_KEY\b/g },
  { name: 'legacy P2P server configuration', pattern: /\bP2P_SERVER\b/g },
  { name: 'legacy P2P environment access', pattern: /process\.env\.P2P_/g },
  { name: 'legacy global application state', pattern: /window\.KK/g },
  { name: 'direct legacy Circle API URL', pattern: /https:\/\/familycircle\.o2gventures\.com\/circle-api/g },
  { name: 'direct legacy Circle group path', pattern: /\/api\/group\//g },
  { name: 'runtime dependency on the brand source repository', pattern: /raw\.githubusercontent\.com\/Elder-ChatGPT\/agent-ai-landing/g },
]

const rendererCircleIdentityRules = [
  { name: 'Circle renderer must not carry caller-supplied fromUserId', pattern: /\bfromUserId\b/g },
  { name: 'Circle renderer must not carry shared serverUserId', pattern: /\bserverUserId\b/g },
  { name: 'Circle renderer must not carry trusted targetServerUserId', pattern: /\btargetServerUserId\b/g },
  { name: 'Circle renderer must not carry shared ownerId', pattern: /\bownerId\b/g },
  { name: 'Circle renderer must not carry raw shared userId', pattern: /\buserId\b/g },
  { name: 'Circle renderer must not carry invitationId', pattern: /\binvitationId\b/g },
  { name: 'Circle renderer must not carry invitation tokens', pattern: /\binvitationToken\b/g },
  { name: 'Circle renderer must not carry temporary passwords', pattern: /\btemporaryPassword\b|\btempPassword\b/g },
]

const publicCircleContractRules = [
  { name: 'public desktop Circle contract must not expose fromUserId', pattern: /\bfromUserId\b/g },
  { name: 'public desktop Circle contract must not expose serverUserId', pattern: /\bserverUserId\b/g },
  { name: 'public desktop Circle contract must not expose targetServerUserId', pattern: /\btargetServerUserId\b/g },
  { name: 'public desktop Circle contract must not expose ownerId', pattern: /\bownerId\b/g },
  { name: 'public desktop Circle contract must not expose raw shared userId', pattern: /\buserId\b/g },
  { name: 'public desktop Circle contract must not expose invitationId', pattern: /\binvitationId\b/g },
  { name: 'public desktop Circle contract must not expose Circle API keys', pattern: /\bCIRCLE_API_KEY\b|X-Kin-Keepers-Key/g },
  { name: 'public desktop Circle contract must not expose legacy group paths', pattern: /\/api\/group\//g },
  { name: 'public desktop Circle contract must not expose invitation tokens', pattern: /\binvitationToken\b/g },
  { name: 'public desktop Circle contract must not expose temporary passwords', pattern: /\btemporaryPassword\b|\btempPassword\b/g },
]

const mainQuarantineRules = [
  { name: 'legacy Circle API-key header', pattern: /X-Kin-Keepers-Key/g },
  { name: 'legacy Circle endpoint URL', pattern: /https:\/\/familycircle\.o2gventures\.com\/circle-api/g },
  { name: 'legacy invitation-check path', pattern: /\/api\/invitation-check/g },
  { name: 'legacy registration path', pattern: /\/api\/register/g },
  { name: 'legacy invitation path', pattern: /\/api\/invitations\//g },
  { name: 'legacy mark-claimed path', pattern: /\/api\/user\/mark-claimed/g },
  { name: 'legacy membership/notification path', pattern: /\/api\/me\//g },
  { name: 'legacy Circle group/tree/write path', pattern: /\/api\/group\//g },
]

const mainForbiddenRules = [
  { name: 'new production code must not use P2P_API_KEY', pattern: /\bP2P_API_KEY\b/g },
  { name: 'new production code must not use P2P_SERVER', pattern: /\bP2P_SERVER\b/g },
]

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath))
    } else if (sourceExtensions.has(extname(entry.name))) {
      files.push(fullPath)
    }
  }

  return files
}

function displayPath(filePath) {
  return relative(root, filePath).split(sep).join('/')
}

function lineNumberFor(content, index) {
  return content.slice(0, index).split('\n').length
}

function isProductionSource(file) {
  return !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
}

function recordMatches(violations, file, content, rules) {
  for (const rule of rules) {
    rule.pattern.lastIndex = 0
    for (const match of content.matchAll(rule.pattern)) {
      violations.push(`${file}:${lineNumberFor(content, match.index ?? 0)} — ${rule.name}`)
    }
  }
}

const violations = []
const rendererFiles = await collectFiles(rendererRoot)
const mainFiles = await collectFiles(mainRoot)

for (const filePath of rendererFiles) {
  const file = displayPath(filePath)
  if (!isProductionSource(file)) continue
  const content = await readFile(filePath, 'utf8')

  recordMatches(violations, file, content, rendererRules)

  if (file.startsWith('src/renderer/features/circles/') || file.startsWith('src/renderer/services/circle/')) {
    recordMatches(violations, file, content, rendererCircleIdentityRules)
  }

  if (file !== desktopCircleClientPath) {
    recordMatches(violations, file, content, [
      {
        name: 'production renderer must access Circle preload only through DesktopCircleClient',
        pattern: /window\.familyCircle\.circle/g,
      },
    ])
  }

  if (file !== mockCircleClientPath) {
    recordMatches(violations, file, content, [
      {
        name: 'MockCircleClient is test/demo-only and must not be used by production renderer code',
        pattern: /\bMockCircleClient\b/g,
      },
    ])
  }

  if (file.startsWith('src/renderer/features/')) {
    recordMatches(violations, file, content, [
      { name: 'feature components must use typed service clients instead of fetch()', pattern: /\bfetch\s*\(/g },
    ])
  }

  if (file.startsWith('src/renderer/features/auth/') || file.startsWith('src/renderer/features/onboarding/')) {
    recordMatches(violations, file, content, [
      { name: 'auth/onboarding must not persist through localStorage', pattern: /\blocalStorage\s*\.\s*setItem\s*\(/g },
      { name: 'auth/onboarding must not persist through sessionStorage', pattern: /\bsessionStorage\s*\.\s*setItem\s*\(/g },
      { name: 'auth/onboarding must not call fetch()', pattern: /\bfetch\s*\(/g },
    ])
  }
}

for (const filePath of mainFiles) {
  const file = displayPath(filePath)
  if (!isProductionSource(file)) continue
  const content = await readFile(filePath, 'utf8')

  recordMatches(violations, file, content, mainForbiddenRules)
  if (file !== legacyAdapterPath) recordMatches(violations, file, content, mainQuarantineRules)
}

const sharedDesktopApi = await readFile(sharedDesktopApiPath, 'utf8')
recordMatches(violations, displayPath(sharedDesktopApiPath), sharedDesktopApi, publicCircleContractRules)

if (violations.length > 0) {
  console.error('Architecture boundary verification failed:')
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}

console.log(
  `Architecture boundary verification passed across ${rendererFiles.length} renderer and ${mainFiles.length} main-process source files plus the public desktop contract.`,
)
