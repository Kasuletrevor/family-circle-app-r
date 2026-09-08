import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function verifyCompiledFilesWhenPresent() {
  const distDir = resolve(root, 'dist')
  if (!existsSync(distDir)) return

  for (const required of [
    'dist/main/main.js',
    'dist/preload/preload.js',
    'dist/renderer/index.html',
  ]) {
    assert(existsSync(resolve(root, required)), `Required compiled package input is missing: ${required}`)
  }
}

function verifyConfig() {
  const build = pkg.build ?? {}
  const target = Array.isArray(build.win?.target) ? build.win.target : []
  const files = Array.isArray(build.files) ? build.files : []

  assert(pkg.devDependencies?.['electron-builder'] === '26.15.3', 'electron-builder must be locked as a development dependency')
  assert(
    pkg.scripts?.['package:win'] === 'npm run build && electron-builder --win nsis --x64',
    'package:win must invoke the locked electron-builder dependency',
  )
  assert(build.appId === 'com.kinkeepers.familycircle', 'Unexpected Electron appId')
  assert(build.productName === 'Family Circle', 'Unexpected Electron productName')
  assert(build.directories?.output === 'release', 'Packaging output must be release/')
  assert(
    target.some((entry) => entry?.target === 'nsis' && Array.isArray(entry.arch) && entry.arch.includes('x64')),
    'Windows packaging must target NSIS x64',
  )
  assert(build.nsis?.artifactName === 'Family-Circle-Setup-${version}.exe', 'Unexpected NSIS artifact name')
  assert(build.nsis?.oneClick === true, 'NSIS installer must be one-click')
  assert(build.nsis?.perMachine === false, 'NSIS installer must be per-user')
  assert(build.nsis?.deleteAppDataOnUninstall === false, 'Uninstall must preserve app data')
  assert(files.includes('dist/**/*'), 'Compiled dist/ output is not packaged')
  assert(files.includes('config/offline-ai-manifest.json'), 'Private AI manifest is not packaged')
  assert(!/\.env|\.gguf|\.bin|models\/|bin\//i.test(files.join('\n')), 'Packaging allowlist contains forbidden secret/model inputs')

  const iconPath = resolve(root, build.win?.icon ?? '')
  assert(build.win?.icon === 'build/family-circle.ico', 'Unexpected Windows icon path')
  assert(existsSync(iconPath) && statSync(iconPath).size > 10_000, 'Windows icon is missing or invalid')
  assert(existsSync(resolve(root, 'config/offline-ai-manifest.json')), 'Private AI manifest file is missing')
  verifyCompiledFilesWhenPresent()

  console.log('Packaging configuration verified')
}

function releaseDirFromArgs(args) {
  const index = args.indexOf('--release-dir')
  if (index === -1) return resolve(root, 'release')
  const value = args[index + 1]
  if (!value) throw new Error('--release-dir requires a path')
  return resolve(value)
}

function filesRecursively(directory) {
  if (!existsSync(directory)) return []

  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...filesRecursively(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function verifyNoForbiddenLooseResources(releaseDir) {
  const resourcesDir = resolve(releaseDir, 'win-unpacked', 'resources')
  if (!existsSync(resourcesDir)) return

  for (const filePath of filesRecursively(resourcesDir)) {
    const normalized = relative(resourcesDir, filePath).replaceAll('\\', '/')
    const lower = normalized.toLowerCase()
    const base = basename(lower)
    const inNodeModules = lower === 'node_modules' || lower.includes('/node_modules/')
    const hasForbiddenSecret = base === '.env' || base.startsWith('.env.')
    const hasForbiddenModelFile = lower.endsWith('.gguf') || lower.endsWith('.bin')
    const hasForbiddenPrivateAiDirectory = !inNodeModules && /(^|\/)(models|bin)(\/|$)/i.test(normalized)

    if (hasForbiddenSecret || hasForbiddenModelFile || hasForbiddenPrivateAiDirectory) {
      throw new Error(`Forbidden packaged resource: ${normalized}`)
    }
  }
}

function verifyRelease(releaseDir) {
  assert(existsSync(releaseDir), `Release directory does not exist: ${releaseDir}`)
  const installers = readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^Family-Circle-Setup-.*\.exe$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  const expectedInstaller = `Family-Circle-Setup-${pkg.version}.exe`

  assert(
    installers.length === 1 && installers[0] === expectedInstaller,
    `Expected exactly one Windows installer named ${expectedInstaller} in ${releaseDir}; found ${installers.join(', ') || 'none'}`,
  )

  const installerPath = resolve(releaseDir, expectedInstaller)
  assert(statSync(installerPath).size > 0, `Windows installer is empty: ${basename(installerPath)}`)
  verifyNoForbiddenLooseResources(releaseDir)
  console.log(`Windows installer verified: ${expectedInstaller}`)
}

try {
  verifyConfig()
  if (!process.argv.slice(2).includes('--config-only')) {
    verifyRelease(releaseDirFromArgs(process.argv.slice(2)))
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
