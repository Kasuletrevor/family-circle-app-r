import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandMark } from './BrandMark'

describe('BrandMark', () => {
  it('renders the existing repo logo with a gold Kin-Keepers name', () => {
    render(<BrandMark />)

    expect(screen.getByRole('img', { name: 'Kin-Keepers logo' })).toBeInTheDocument()
    expect(screen.queryByText('K')).not.toBeInTheDocument()
    expect(screen.getByText('Kin-Keepers')).toHaveClass('brand-mark__name')
    expect(screen.getByText('Private by design.')).toBeInTheDocument()
  })

  it('keeps the repo logo and Kin-Keepers name in compact mode while hiding the tagline', () => {
    render(<BrandMark compact />)

    expect(screen.getByRole('img', { name: 'Kin-Keepers logo' })).toBeInTheDocument()
    expect(screen.getByText('Kin-Keepers')).toHaveClass('brand-mark__name')
    expect(screen.queryByText('Private by design.')).not.toBeInTheDocument()
  })

  it('uses the round public/kin-round.png as the single logo source and copies public assets through Vite', () => {
    const root = process.cwd()
    const source = readFileSync(resolve(root, 'src/renderer/design-system/BrandMark.tsx'), 'utf8')
    const css = readFileSync(resolve(root, 'src/renderer/design-system/BrandMark.css'), 'utf8')
    const vite = readFileSync(resolve(root, 'vite.config.ts'), 'utf8')

    expect(existsSync(resolve(root, 'public/kin-round.png'))).toBe(true)
    expect(existsSync(resolve(root, 'public/kin-cropped.jpg'))).toBe(false)
    expect(existsSync(resolve(root, 'src/renderer/assets/kin-keepers-logo.jpg'))).toBe(false)
    expect(source).toContain('src="./kin-round.png"')
    expect(source).not.toContain("kin-keepers-logo.jpg")
    expect(vite).toContain("publicDir: resolve(__dirname, 'public')")
    // Jose: use the round circle logo.
    expect(css).toMatch(/\.brand-mark__logo-frame\s*\{[^}]*border-radius:\s*50%/s)
    expect(css).toMatch(/\.brand-mark__name\s*\{[^}]*color:\s*var\(--kk-gold\)/s)
  })
})
