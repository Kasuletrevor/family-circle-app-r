import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const preloadDir = resolve(root, 'dist/preload')
const preloadPath = resolve(preloadDir, 'preload.js')

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!existsSync(preloadPath)) {
  fail('Sandboxed preload bundle is missing: dist/preload/preload.js')
}

const jsFiles = readdirSync(preloadDir)
  .filter((name) => name.endsWith('.js'))
  .sort()

if (jsFiles.length !== 1 || jsFiles[0] !== 'preload.js') {
  fail(`Sandboxed preload must contain exactly one JavaScript bundle; found: ${jsFiles.join(', ') || 'none'}`)
}

const source = readFileSync(preloadPath, 'utf8')
const runtimeRequires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)]
  .map((match) => match[1])
const unsupportedRequires = [...new Set(runtimeRequires.filter((specifier) => specifier !== 'electron'))]

if (unsupportedRequires.length > 0) {
  fail(`Sandboxed preload contains unsupported runtime require(s): ${unsupportedRequires.join(', ')}`)
}

if (!runtimeRequires.includes('electron')) {
  fail('Sandboxed preload bundle does not contain the expected Electron runtime import')
}

console.log('Sandboxed preload bundle verified')
