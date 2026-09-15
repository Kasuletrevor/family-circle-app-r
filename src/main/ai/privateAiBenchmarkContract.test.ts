import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('private AI benchmark harness contract', () => {
  it('benchmarks fast and complex loopback generation with comparable latency and quality fields', () => {
    const benchmarkPath = resolve(process.cwd(), 'scripts/benchmark-private-ai.mjs')
    expect(existsSync(benchmarkPath)).toBe(true)
    if (!existsSync(benchmarkPath)) return

    const source = readFileSync(benchmarkPath, 'utf8')
    for (const field of [
      'caseId',
      'model',
      'firstTokenMs',
      'totalMs',
      'generatedTokens',
      'peakRssBytes',
      'correct',
      'grounded',
    ]) {
      expect(source).toContain(field)
    }
    expect(source).toContain('127.0.0.1')
    expect(source).toContain('8082')
    expect(source).toContain('8080')
    expect(source).toContain("'fast'")
    expect(source).toContain("'complex'")
  })

  it('is an explicit developer tool and is never run from app startup or normal CI/check', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main/main.ts'), 'utf8')
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    const desktopCi = readFileSync(resolve(process.cwd(), '.github/workflows/desktop-shell-ci.yml'), 'utf8')
    const windowsCi = readFileSync(resolve(process.cwd(), '.github/workflows/windows-package.yml'), 'utf8')

    expect(main).not.toContain('benchmark-private-ai')
    expect(pkg.scripts?.check ?? '').not.toContain('benchmark')
    expect(desktopCi).not.toContain('benchmark-private-ai')
    expect(windowsCi).not.toContain('benchmark-private-ai')
  })
})
