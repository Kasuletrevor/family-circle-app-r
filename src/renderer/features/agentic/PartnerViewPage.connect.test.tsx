import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppServicesProvider } from '../../app/services'
import { MockCircleClient } from '../../services/circle/MockCircleClient'
import { fakeAgenticClient } from '../../test/fakeAgenticClient'
import { PartnerViewPage } from './PartnerViewPage'

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function renderView(path: string) {
  const agentic = fakeAgenticClient()
  render(
    <AppServicesProvider services={{ circle: new MockCircleClient(), agentic }}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/agentic/guardian-angel/view" element={<PartnerViewPage service="guardian-angel" />} />
          <Route path="/agentic/guardian-angel" element={<p>Guardian Angel page</p>} />
        </Routes>
      </MemoryRouter>
    </AppServicesProvider>,
  )
  return agentic
}

const where = () => screen.getByTestId('where').textContent

describe('PartnerViewPage connecting Kin-Keepers.ai', () => {
  it('shows the connect page the main process loaded, with a way to cancel', async () => {
    const agentic = renderView('/agentic/guardian-angel/view?page=connect')
    expect(screen.getByRole('heading', { name: 'Connect Kin-Keepers.ai' })).toBeInTheDocument()
    await waitFor(() => expect(agentic.openView).toHaveBeenCalledWith('guardian-angel', undefined))
    expect(screen.queryByRole('link', { name: /All templates/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(agentic.cancelConnect).toHaveBeenCalledTimes(1)
    expect(where()).toBe('/agentic/guardian-angel?tab=mine')
  })

  it('returns to My Guardian Angels once connected, keeping the template to add', async () => {
    const agentic = renderView('/agentic/guardian-angel/view?page=connect&add=7')
    await waitFor(() => expect(agentic.onAngelConnection).toHaveBeenCalled())
    act(() => agentic.emitConnection({ status: 'connected', email: null }))
    expect(where()).toBe('/agentic/guardian-angel?tab=mine&add=7')
  })

  it('returns without adding when connecting fails', async () => {
    const agentic = renderView('/agentic/guardian-angel/view?page=connect&add=7')
    await waitFor(() => expect(agentic.onAngelConnection).toHaveBeenCalled())
    act(() => agentic.emitConnection({ status: 'disconnected', problem: 'connect-failed' }))
    expect(where()).toBe('/agentic/guardian-angel?tab=mine')
  })

  it('stays put while still connecting', async () => {
    const agentic = renderView('/agentic/guardian-angel/view?page=connect')
    await waitFor(() => expect(agentic.onAngelConnection).toHaveBeenCalled())
    act(() => agentic.emitConnection({ status: 'connecting' }))
    expect(where()).toBe('/agentic/guardian-angel/view?page=connect')
  })

  it('opens the settings or test page of an own angel', async () => {
    const agentic = renderView('/agentic/guardian-angel/view?angel=5&page=run')
    await waitFor(() => expect(agentic.openView).toHaveBeenCalledWith('guardian-angel', { kind: 'angel', angelId: '5', page: 'run' }))
    expect(screen.getByRole('heading', { name: 'Guardian Angel' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /My Guardian Angels/ })).toHaveAttribute('href', '/agentic/guardian-angel?tab=mine')
  })
})
