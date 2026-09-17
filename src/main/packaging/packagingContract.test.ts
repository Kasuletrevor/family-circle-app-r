import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageJson {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  build?: {
    appId?: string
    productName?: string
    files?: string[]
    extraResources?: Array<{ from?: string; to?: string }>
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

  it('does not package the obsolete SMTP transport or Nodemailer dependencies', () => {
    expect(pkg.dependencies?.nodemailer).toBeUndefined()
    expect(pkg.devDependencies?.['@types/nodemailer']).toBeUndefined()
    expect(existsSync(resolve(root, 'node_modules/nodemailer'))).toBe(false)
    expect(existsSync(resolve(root, 'node_modules/@types/nodemailer'))).toBe(false)
    const mailerSource = readFileSync(resolve(root, 'src/main/auth/RecoveryMailer.ts'), 'utf8')
    expect(mailerSource).not.toMatch(/nodemailer|SMTP_HOST|SMTP_PORT|SMTP_SECURE|MAIL_HOST/)
  })

  it('packages compiled code, approved manifests/licenses, and the generated demo mail resource', () => {
    const files = pkg.build?.files ?? []
    expect(files).toContain('dist/**/*')
    expect(files).toContain('config/offline-ai-manifest.json')
    expect(files).toContain('config/offline-voice-manifest.json')
    expect(files).toContain('third_party/whisper.cpp-LICENSE.txt')
    expect(files.join('\n')).not.toMatch(/\.env|\.gguf|models\/|bin\/|whisper-cli\.exe|ggml-base\.bin|whisper-bin/i)
    expect(pkg.build?.extraResources).toContainEqual({
      from: 'build/demo-mail-config.json',
      to: 'demo-mail-config.json',
    })
    expect(existsSync(resolve(root, 'config/offline-voice-manifest.json'))).toBe(true)
    expect(existsSync(resolve(root, 'third_party/whisper.cpp-LICENSE.txt'))).toBe(true)
  })

  it('has a real Windows icon', () => {
    const icon = resolve(root, 'build/family-circle.ico')
    expect(existsSync(icon)).toBe(true)
    expect(statSync(icon).size).toBeGreaterThan(10_000)
  })
})
