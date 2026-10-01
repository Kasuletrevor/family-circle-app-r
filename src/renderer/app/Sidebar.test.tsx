import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

afterEach(() => {
  delete (window as { familyCircle?: unknown }).familyCircle
})

function renderSidebar(getVersion = vi.fn(async () => '0.9.2')) {
  ;(window as { familyCircle?: unknown }).familyCircle = {
    privateAi: {
      getStatus: vi.fn(async () => ({ state: 'ready', ready: true, repairRequired: false, totalSizeBytes: 0, downloadSizeBytes: 0, version: '1.3.0', message: null })),
      onProgress: vi.fn(() => () => undefined),
    },
  }
  render(
    <MemoryRouter>
      <Sidebar getVersion={getVersion} />
    </MemoryRouter>,
  )
  return getVersion
}

describe('Sidebar', () => {
  it('shows that the workspace is in Ask mode', () => {
    renderSidebar()
    expect(screen.getByLabelText('Current mode: Ask mode')).toHaveTextContent('Ask mode')
  })

  it('shows the installed Family Circle version', async () => {
    const getVersion = renderSidebar()
    expect(await screen.findByText('Family Circle v0.9.2')).toBeInTheDocument()
    expect(getVersion).toHaveBeenCalledTimes(1)
  })

  it('names the local answer model in the Local AI card', async () => {
    renderSidebar()
    expect(screen.getByText('Qwen3.5 0.8B · on this computer')).toBeInTheDocument()
    expect(await screen.findByText(/Ready \(Offline\)/)).toBeInTheDocument()
  })
})
