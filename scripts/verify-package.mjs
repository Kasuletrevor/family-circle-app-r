import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
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

function verifyConfig() {
  const build = pkg.build ?? {}
  const target = Array.isArray(build.win?.target) ? build.win.target : []
  const files = Array.isArray(build.files) ? build.files : []

  assert(pkg.scripts?.['package:win']?.includes('electron-builder'), 'package:win must invoke electron-builder')
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
  assert(!/\.env|\.gguf|models\/|bin\//i.test(files.join('\n')), 'Packaging allowlist contains forbidden secret/model inputs')

  const iconPath = resolve(root, build.win?.icon ?? '')
  assert(build.win?.icon === 'build/family-circle.ico', 'Unexpected Windows icon path')
  assert(existsSync(iconPath) && statSync(iconPath).size > 10_000, 'Windows icon is missing or invalid')
  assert(existsSync(resolve(root, 'config/offline-ai-manifest.json')), 'Private AI manifest file is missing')

  console.log('Packaging configuration verified')
}

function releaseDirFromArgs(args) {
  const index = args.indexOf('--release-dir')
  if (index === -1) return resolve(root, 'release')
  const value = args[index + 1]
  if (!value) throw new Error('--release-dir requires a path')
  return resolve(value)
}

function verifyRelease(releaseDir) {
  assert(existsSync(releaseDir), `Release directory does not exist: ${releaseDir}`)
  const installers = readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^Family-Circle-Setup-.*\.exe$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  assert(
    installers.length === 1,
    `Expected exactly one Windows installer in ${releaseDir}; found ${installers.length}`,
  )

  const installerPath = resolve(releaseDir, installers[0])
  assert(statSync(installerPath).size > 0, `Windows installer is empty: ${basename(installerPath)}`)
  console.log(`Windows installer verified: ${installers[0]}`)
}

try {
  verifyConfig()
  if (!process.argv.slice(2).includes('--config-only')) {
    verifyRelease(releaseDirFromArgs(process.argv.slice(2)))
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
