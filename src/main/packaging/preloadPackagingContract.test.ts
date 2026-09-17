import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageJson {
  scripts?: Record<string, string>
}

const root = resolve(__dirname, '../../..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as PackageJson

describe('sandboxed preload packaging contract', () => {
  it('bundles the preload into one CommonJS file instead of shipping local require dependencies', () => {
    expect(pkg.scripts?.['build:electron']).toContain('vite build --config vite.preload.config.ts')

    const preloadConfig = readFileSync(resolve(root, 'vite.preload.config.ts'), 'utf8')
    expect(preloadConfig).toMatch(/formats:\s*\[\s*['"]cjs['"]\s*\]/)
    expect(preloadConfig).toMatch(/external:\s*\[\s*['"]electron['"]\s*\]/)
    expect(preloadConfig).toMatch(/src\/preload\/preload\.ts/)
  })
})
