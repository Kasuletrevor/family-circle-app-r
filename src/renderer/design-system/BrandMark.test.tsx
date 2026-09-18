import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandMark } from './BrandMark'

describe('BrandMark', () => {
  it('uses the existing repo logo with a gold Kin-Keepers name and no fallback K', () => {
    render(<BrandMark />)

    expect(screen.getByRole('img', { name: 'Kin-Keepers logo' })).toBeInTheDocument()
    expect(screen.queryByText('K')).not.toBeInTheDocument()
    expect(screen.getByText('Kin-Keepers')).toHaveClass('brand-mark__name')
    expect(screen.getByText('Private by design.')).toBeInTheDocument()
  })

  it('keeps the logo and gold name in compact mode while hiding the tagline', () => {
    render(<BrandMark compact />)

    expect(screen.getByRole('img', { name: 'Kin-Keepers logo' })).toBeInTheDocument()
    expect(screen.getByText('Kin-Keepers')).toHaveClass('brand-mark__name')
    expect(screen.queryByText('Private by design.')).not.toBeInTheDocument()
  })

  it('bundles the existing public logo through Vite and styles the name gold', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/design-system/BrandMark.tsx'), 'utf8')
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/design-system/BrandMark.css'), 'utf8')

    expect(source).toMatch(/import\s+kinLogo\s+from\s+['"].*public\/kin-cropped\.jpg['"]/)
    expect(source).not.toContain('src="/kin-cropped.jpg"')
    expect(css).toMatch(/\.brand-mark__name\s*\{[^}]*color:\s*var\(--kk-gold\)/s)
  })
})
