import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageJson {
  scripts?: Record<string, string>
  devDependencies?: Record<string, string>
  build?: {
    appId?: string
    productName?: string
    files?: string[]
    directories?: { output?: string }
    win?: { target?: Array<{ target?: string; arch?: string[] }>; icon?: string }
    nsis?: {
      artifactName?: string
      oneClick?: boolean
      perMachine?: boolean
      deleteAppDataOnUninstall?: boolean
    }
  }
}

const root = resolve(__dirname, '../../..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as PackageJson

describe('Windows packaging contract', () => {
  it('configures the small Family Circle x64 NSIS installer', () => {
    expect(pkg.devDependencies?.['electron-builder']).toBe('26.15.3')
    expect(pkg.scripts?.['package:win']).toBe('npm run build && electron-builder --win nsis --x64')
    expect(pkg.build?.appId).toBe('com.kinkeepers.familycircle')
    expect(pkg.build?.productName).toBe('Family Circle')
    expect(pkg.build?.directories?.output).toBe('release')
    expect(pkg.build?.win?.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
    expect(pkg.build?.nsis?.artifactName).toBe('Family-Circle-Setup-${version}.exe')
    expect(pkg.build?.nsis?.oneClick).toBe(true)
    expect(pkg.build?.nsis?.perMachine).toBe(false)
    expect(pkg.build?.nsis?.deleteAppDataOnUninstall).toBe(false)
  })

  it('packages the compiled app and manifest but no secret/model inputs', () => {
    const files = pkg.build?.files ?? []
    expect(files).toContain('dist/**/*')
    expect(files).toContain('config/offline-ai-manifest.json')
    expect(files.join('\n')).not.toMatch(/\.env|\.gguf|models\/|bin\//i)
  })

  it('has a real Windows icon', () => {
    const icon = resolve(root, 'build/family-circle.ico')
    expect(existsSync(icon)).toBe(true)
    expect(statSync(icon).size).toBeGreaterThan(10_000)
  })
})
