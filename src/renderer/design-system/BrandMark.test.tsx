import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandMark } from './BrandMark'

describe('BrandMark', () => {
  it('renders the Kin-Keepers identity and privacy line', () => {
    render(<BrandMark />)

    expect(screen.getByRole('img', { name: /kin-keepers/i })).toBeInTheDocument()
    expect(screen.getByText('Kin-Keepers')).toBeInTheDocument()
    expect(screen.getByText('Private by design.')).toBeInTheDocument()
  })
})
