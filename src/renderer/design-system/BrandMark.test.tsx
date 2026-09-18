import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandMark } from './BrandMark'

describe('BrandMark', () => {
  it('renders the official bundled Kin-Keepers wordmark without fallback or duplicate brand text', () => {
    render(<BrandMark />)

    const logo = screen.getByRole('img', { name: 'Kin-Keepers' })
    expect(logo.getAttribute('src')).toContain('kin-keepers-logo')
    expect(logo.getAttribute('src')).not.toBe('/kin-cropped.jpg')
    expect(screen.queryByText('K')).not.toBeInTheDocument()
    expect(screen.queryByText('Kin-Keepers')).not.toBeInTheDocument()
    expect(screen.getByText('Private by design.')).toBeInTheDocument()
  })

  it('keeps the official wordmark in compact mode while hiding the tagline', () => {
    render(<BrandMark compact />)

    expect(screen.getByRole('img', { name: 'Kin-Keepers' })).toBeInTheDocument()
    expect(screen.queryByText('Private by design.')).not.toBeInTheDocument()
  })
})
