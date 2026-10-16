import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { PartnerServiceKey } from '../../../shared/agentic'
import { AppServicesProvider } from '../../app/services'
import { MockCircleClient } from '../../services/circle/MockCircleClient'
import { fakeAgenticClient } from '../../test/fakeAgenticClient'
import { PartnerViewPage } from './PartnerViewPage'

function Leave() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate('/vault')}>Go to vault</button>
}

function renderView(path: string, service: PartnerServiceKey) {
  const agentic = fakeAgenticClient()
  const route = path.split('?')[0]!
  render(
    <AppServicesProvider services={{ circle: new MockCircleClient(), agentic }}>
      <MemoryRouter initialEntries={[path]}>
        <Leave />
        <Routes>
          <Route path={route} element={<PartnerViewPage service={service} />} />
          <Route path="/vault" element={<p>Vault page</p>} />
        </Routes>
      </MemoryRouter>
    </AppServicesProvider>,
  )
  return agentic
}

describe('PartnerViewPage', () => {
  it('opens the service, places the view and says nothing is shared', async () => {
    const agentic = renderView('/agentic/ubercare', 'ubercare')
    expect(screen.getByRole('heading', { name: 'UberCare' })).toBeInTheDocument()
    expect(screen.getByText('Partner service. Family Circle shares nothing with it.')).toBeInTheDocument()
    await waitFor(() => expect(agentic.openView).toHaveBeenCalledWith('ubercare', { kind: 'start' }))
    await waitFor(() => expect(agentic.setViewBounds).toHaveBeenCalledWith('ubercare', expect.objectContaining({ x: expect.any(Number) })))
  })

  it('opens a template from the address', async () => {
    const agentic = renderView('/agentic/guardian-angel/view?template=7', 'guardian-angel')
    await waitFor(() => expect(agentic.openView).toHaveBeenCalledWith('guardian-angel', { kind: 'template', templateId: '7' }))
  })

  it('opens Care Builder from the address and links back to the templates', async () => {
    const agentic = renderView('/agentic/guardian-angel/view?page=care-builder', 'guardian-angel')
    await waitFor(() => expect(agentic.openView).toHaveBeenCalledWith('guardian-angel', { kind: 'care-builder' }))
    expect(screen.getByRole('link', { name: /All templates/ })).toHaveAttribute('href', '/agentic/guardian-angel')
  })

  it('runs the header commands', async () => {
    const agentic = renderView('/agentic/marketplace', 'marketplace')
    act(() => agentic.emitState({ service: 'marketplace', state: 'ready', canGoBack: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }))
    expect(agentic.viewCommand.mock.calls).toEqual([['marketplace', 'back'], ['marketplace', 'reload'], ['marketplace', 'open-external']])
  })

  it('shows a load failure over a hidden view and retries', async () => {
    const agentic = renderView('/agentic/ubercare', 'ubercare')
    await waitFor(() => expect(agentic.setViewBounds).toHaveBeenCalled())
    act(() => agentic.emitState({ service: 'ubercare', state: 'failed', canGoBack: false }))
    expect(screen.getByText("Couldn't open UberCare")).toBeInTheDocument()
    await waitFor(() => expect(agentic.hideView).toHaveBeenCalledWith('ubercare'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(agentic.viewCommand).toHaveBeenLastCalledWith('ubercare', 'reload')
  })

  it('ignores status from other services', () => {
    const agentic = renderView('/agentic/ubercare', 'ubercare')
    act(() => agentic.emitState({ service: 'marketplace', state: 'failed', canGoBack: false }))
    expect(screen.queryByText(/Couldn't open/)).not.toBeInTheDocument()
  })

  it('hides a view whose open finishes after the page was left', async () => {
    let finishOpen!: () => void
    const agentic = fakeAgenticClient()
    agentic.openView.mockImplementationOnce(() => new Promise<undefined>((resolve) => { finishOpen = () => resolve(undefined) }))
    render(
      <AppServicesProvider services={{ circle: new MockCircleClient(), agentic }}>
        <MemoryRouter initialEntries={['/agentic/ubercare']}>
          <Leave />
          <Routes>
            <Route path="/agentic/ubercare" element={<PartnerViewPage service="ubercare" />} />
            <Route path="/vault" element={<p>Vault page</p>} />
          </Routes>
        </MemoryRouter>
      </AppServicesProvider>,
    )
    await waitFor(() => expect(agentic.openView).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Go to vault' }))
    expect(agentic.hideView).not.toHaveBeenCalled()
    await act(async () => finishOpen())
    expect(agentic.hideView).toHaveBeenCalledWith('ubercare')
  })

  it('hides the view while a menu is open and when leaving the page', async () => {
    const agentic = renderView('/agentic/ubercare', 'ubercare')
    await waitFor(() => expect(agentic.setViewBounds).toHaveBeenCalled())
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    act(() => { document.body.appendChild(menu) })
    await waitFor(() => expect(agentic.hideView).toHaveBeenCalledWith('ubercare'))
    agentic.openView.mockClear()
    act(() => { menu.remove() })
    await waitFor(() => expect(agentic.openView).toHaveBeenCalledWith('ubercare'))

    agentic.hideView.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Go to vault' }))
    expect(screen.getByText('Vault page')).toBeInTheDocument()
    expect(agentic.hideView).toHaveBeenCalledWith('ubercare')
  })
})
