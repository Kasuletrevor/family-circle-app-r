import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../..')
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

// The SQLite-backed code and its tests need node:sqlite, which older Node versions cannot load.
describe('Node version pin', () => {
  it('keeps package.json, .nvmrc and every CI job on Node 24', () => {
    const packageJson = JSON.parse(read('package.json')) as { engines?: { node?: string } }
    expect(packageJson.engines?.node).toBe('>=24')
    expect(read('.nvmrc').trim()).toBe('24')

    for (const workflow of ['.github/workflows/desktop-shell-ci.yml', '.github/workflows/windows-package.yml']) {
      const versions = [...read(workflow).matchAll(/node-version:\s*(\S+)/g)].map((match) => match[1])
      expect(versions.length).toBeGreaterThan(0)
      expect(new Set(versions)).toEqual(new Set(['24']))
    }
  })
})
