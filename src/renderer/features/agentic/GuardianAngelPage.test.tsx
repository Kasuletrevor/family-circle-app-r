import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppServicesProvider } from '../../app/services'
import type { AgenticClient } from '../../services/agentic/AgenticClient'
import { MockCircleClient } from '../../services/circle/MockCircleClient'
import { fakeAgenticClient, SAMPLE_CATALOG } from '../../test/fakeAgenticClient'
import { GuardianAngelPage } from './GuardianAngelPage'

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function renderPage(agentic: AgenticClient = fakeAgenticClient()) {
  render(
    <AppServicesProvider services={{ circle: new MockCircleClient(), agentic }}>
      <MemoryRouter initialEntries={['/agentic/guardian-angel']}>
        <Routes>
          <Route path="/agentic/guardian-angel" element={<GuardianAngelPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </AppServicesProvider>,
  )
  return agentic
}

describe('GuardianAngelPage', () => {
  it('groups templates by category with their safety rules', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Elder companion' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Medication and appointments' })).toBeInTheDocument()
    const card = screen.getByRole('article', { name: 'Elder Companion' })
    expect(within(card).getByText('No medical advice')).toBeInTheDocument()
    expect(within(card).getByText('Self harm mentions')).toBeInTheDocument()
    expect(screen.getByText(/Family Circle shares nothing/)).toBeInTheDocument()
  })

  it('opens a template in the secure view', async () => {
    renderPage()
    const card = await screen.findByRole('article', { name: 'Elder Companion' })
    fireEvent.click(within(card).getByRole('button', { name: 'Use this template' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/agentic/guardian-angel/view?template=7')
  })

  it('offers sign in and Care Builder', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Care Builder' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/agentic/guardian-angel/view?page=care-builder')
  })

  it('filters by search and says when nothing matches', async () => {
    renderPage()
    await screen.findByRole('article', { name: 'Elder Companion' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search templates' }), { target: { value: 'pill' } })
    expect(screen.getByRole('article', { name: 'Pill Reminder' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Elder Companion' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search templates' }), { target: { value: 'zzz' } })
    expect(screen.getByText('No templates match “zzz”.')).toBeInTheDocument()
  })

  it('shows the saved copy when offline and retries', async () => {
    const getCatalog = vi.fn()
      .mockResolvedValueOnce({ ...SAMPLE_CATALOG, stale: true })
      .mockResolvedValueOnce(SAMPLE_CATALOG)
    renderPage(fakeAgenticClient({ getCatalog }))
    expect(await screen.findByText(/Showing the copy from/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByText(/Showing the copy from/)).not.toBeInTheDocument())
    expect(getCatalog).toHaveBeenLastCalledWith(true)
  })

  it('explains when the catalog cannot be reached', async () => {
    renderPage(fakeAgenticClient({ getCatalog: vi.fn(async () => ({ status: 'unavailable' as const })) }))
    expect(await screen.findByText("Couldn't reach Guardian Angel")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('treats a failed request like an unreachable catalog', async () => {
    renderPage(fakeAgenticClient({ getCatalog: vi.fn(async () => { throw new Error('ipc') }) }))
    expect(await screen.findByText("Couldn't reach Guardian Angel")).toBeInTheDocument()
  })
})
