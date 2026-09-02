import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from './App'

const navigationLabels = [
  'Home',
  'My Circles',
  'Family Tree',
  'Members',
  'Invitations',
  'Stories',
  'Vault',
  'Memories',
  'AI Assistant',
  'Settings',
]

describe('App shell', () => {
  it('renders stable desktop navigation and changes routes without leaving the shell', () => {
    render(
      <MemoryRouter initialEntries={['/family-tree']}>
        <App />
      </MemoryRouter>,
    )

    for (const label of navigationLabels) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }

    expect(screen.getByRole('link', { name: 'Family Tree' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Family Tree' })).toBeInTheDocument()
    expect(screen.getByText('Kasule Family')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /search family circle/i })).toBeInTheDocument()
    expect(screen.getByText('Ready (Offline)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Members' }))
    expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument()
  })
})
