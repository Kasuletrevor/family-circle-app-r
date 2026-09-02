import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const rendererRoot = join(root, 'src', 'renderer')
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.html'])

const rendererRules = [
  { name: 'legacy shared API key', pattern: /P2P_API_KEY/g },
  { name: 'legacy shared API-key header', pattern: /X-Kin-Keepers-Key/g },
  { name: 'legacy P2P environment access', pattern: /process\.env\.P2P_/g },
  { name: 'legacy global application state', pattern: /window\.KK/g },
  { name: 'direct legacy Circle API URL', pattern: /https:\/\/familycircle\.o2gventures\.com\/circle-api/g },
  { name: 'runtime dependency on the brand source repository', pattern: /raw\.githubusercontent\.com\/Elder-ChatGPT\/agent-ai-landing/g },
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

const violations = []
const files = await collectFiles(rendererRoot)

for (const filePath of files) {
  const content = await readFile(filePath, 'utf8')
  const file = displayPath(filePath)

  for (const rule of rendererRules) {
    rule.pattern.lastIndex = 0
    for (const match of content.matchAll(rule.pattern)) {
      violations.push(`${file}:${lineNumberFor(content, match.index ?? 0)} — ${rule.name}`)
    }
  }

  if (file.startsWith('src/renderer/features/')) {
    const directFetchPattern = /\bfetch\s*\(/g
    for (const match of content.matchAll(directFetchPattern)) {
      violations.push(`${file}:${lineNumberFor(content, match.index ?? 0)} — feature components must use typed service clients instead of fetch()`)
    }
  }
}

if (violations.length > 0) {
  console.error('Renderer boundary verification failed:')
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}

console.log(`Renderer boundary verification passed across ${files.length} source files.`)
