import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AddAngelResult, MyAngelsResult } from '../../../shared/agentic'
import { AppServicesProvider } from '../../app/services'
import { MockCircleClient } from '../../services/circle/MockCircleClient'
import { fakeAgenticClient, SAMPLE_ANGEL } from '../../test/fakeAgenticClient'
import { GuardianAngelPage } from './GuardianAngelPage'

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function renderAt(path: string, agentic = fakeAgenticClient()) {
  render(
    <AppServicesProvider services={{ circle: new MockCircleClient(), agentic }}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/agentic/guardian-angel" element={<GuardianAngelPage />} />
          <Route path="*" element={<p>Elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </AppServicesProvider>,
  )
  return agentic
}

function connectedClient() {
  const agentic = fakeAgenticClient()
  agentic.getAngelConnection.mockResolvedValue({ status: 'connected', email: 'pat@example.test' })
  agentic.getMyAngels.mockResolvedValue({
    status: 'ready',
    angels: [SAMPLE_ANGEL, { ...SAMPLE_ANGEL, id: '6', name: 'Evening Chat', templateId: null, templateName: null, runCount: 3 }],
  })
  return agentic
}

const where = () => screen.getByTestId('where').textContent

describe('My Guardian Angels', () => {
  it('switches between the Templates and My Guardian Angels tabs', async () => {
    renderAt('/agentic/guardian-angel')
    expect(await screen.findByRole('tab', { name: 'Templates' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'My Guardian Angels' }))
    expect(where()).toBe('/agentic/guardian-angel?tab=mine')
    expect(await screen.findByRole('button', { name: 'Connect Kin-Keepers.ai' })).toBeInTheDocument()
    expect(screen.getByText(/Family Circle shares nothing about your family/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    expect(where()).toBe('/agentic/guardian-angel')
  })

  it('connects in the secure view', async () => {
    const agentic = renderAt('/agentic/guardian-angel?tab=mine')
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Kin-Keepers.ai' }))
    await waitFor(() => expect(where()).toBe('/agentic/guardian-angel/view?page=connect'))
    expect(agentic.connect).toHaveBeenCalledTimes(1)
  })

  it('starts one connection however quickly Connect is clicked', async () => {
    const agentic = fakeAgenticClient()
    let finish!: () => void
    agentic.connect.mockImplementation(() => new Promise<undefined>((resolve) => { finish = () => resolve(undefined) }))
    renderAt('/agentic/guardian-angel?tab=mine', agentic)
    const button = await screen.findByRole('button', { name: 'Connect Kin-Keepers.ai' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)
    expect(agentic.connect).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    await waitFor(() => expect(where()).toBe('/agentic/guardian-angel/view?page=connect'))
    expect(agentic.connect).toHaveBeenCalledTimes(1)
  })

  it('says why a connection ended or failed', async () => {
    const ended = fakeAgenticClient()
    ended.getAngelConnection.mockResolvedValue({ status: 'disconnected', problem: 'ended' })
    renderAt('/agentic/guardian-angel?tab=mine', ended)
    expect(await screen.findByRole('alert')).toHaveTextContent('Your Kin-Keepers.ai connection has ended. Connect again.')
  })

  it('offers to try again after a failed connection', async () => {
    const failed = fakeAgenticClient()
    failed.getAngelConnection.mockResolvedValue({ status: 'disconnected', problem: 'connect-failed' })
    renderAt('/agentic/guardian-angel?tab=mine', failed)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't connect. Try again.")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('lists connected angels with their template and runs', async () => {
    renderAt('/agentic/guardian-angel?tab=mine', connectedClient())
    const morning = await screen.findByRole('article', { name: 'Morning Check-in' })
    expect(screen.getByText('Connected as pat@example.test')).toBeInTheDocument()
    expect(within(morning).getByText('Based on Elder Companion')).toBeInTheDocument()
    expect(within(morning).queryByText(/cloud AI|OpenAI|Kin-Keepers servers/)).not.toBeInTheDocument()
    expect(within(morning).getByText('Never run')).toBeInTheDocument()
    expect(within(morning).getByText('No medical advice')).toBeInTheDocument()
    const evening = screen.getByRole('article', { name: 'Evening Chat' })
    expect(within(evening).getByText('Ran 3 times')).toBeInTheDocument()
  })

  it('opens settings and testing in the secure view', async () => {
    renderAt('/agentic/guardian-angel?tab=mine', connectedClient())
    const morning = await screen.findByRole('article', { name: 'Morning Check-in' })
    fireEvent.click(within(morning).getByRole('button', { name: 'Test' }))
    expect(where()).toBe('/agentic/guardian-angel/view?angel=5&page=run')
  })

  it('asks before removing, then reloads the list', async () => {
    const agentic = renderAt('/agentic/guardian-angel?tab=mine', connectedClient())
    const morning = await screen.findByRole('article', { name: 'Morning Check-in' })
    fireEvent.click(within(morning).getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Morning Check-in from your Guardian Angels?' })
    expect(within(dialog).getByText("This deletes it on Kin-Keepers.ai and can't be undone.")).toBeInTheDocument()
    expect(agentic.removeAngel).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Removed Morning Check-in.')).toBeInTheDocument()
    expect(agentic.removeAngel).toHaveBeenCalledWith('5')
    expect(agentic.getMyAngels).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the angel when removing is cancelled', async () => {
    const agentic = renderAt('/agentic/guardian-angel?tab=mine', connectedClient())
    fireEvent.click(within(await screen.findByRole('article', { name: 'Morning Check-in' })).getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(agentic.removeAngel).not.toHaveBeenCalled()
  })

  it('points to the templates when there are no angels yet', async () => {
    const agentic = connectedClient()
    agentic.getMyAngels.mockResolvedValue({ status: 'ready', angels: [] })
    renderAt('/agentic/guardian-angel?tab=mine', agentic)
    expect(await screen.findByText('You have no Guardian Angels yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Browse templates' }))
    expect(where()).toBe('/agentic/guardian-angel')
  })

  it('disconnects', async () => {
    const agentic = renderAt('/agentic/guardian-angel?tab=mine', connectedClient())
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(agentic.disconnect).toHaveBeenCalledTimes(1))
  })

  it('offers a retry when Kin-Keepers.ai cannot be reached', async () => {
    const agentic = connectedClient()
    agentic.getMyAngels.mockResolvedValue({ status: 'unavailable' })
    renderAt('/agentic/guardian-angel?tab=mine', agentic)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach Kin-Keepers.ai")
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(agentic.getMyAngels).toHaveBeenCalledTimes(2))
  })

  it('loads the list when the connection finishes', async () => {
    const agentic = fakeAgenticClient()
    agentic.getMyAngels.mockResolvedValue({ status: 'ready', angels: [SAMPLE_ANGEL] })
    renderAt('/agentic/guardian-angel?tab=mine', agentic)
    await screen.findByRole('button', { name: 'Connect Kin-Keepers.ai' })
    act(() => agentic.emitConnection({ status: 'connected', email: null }))
    expect(await screen.findByRole('article', { name: 'Morning Check-in' })).toBeInTheDocument()
    expect(screen.getByText('Connected to Kin-Keepers.ai')).toBeInTheDocument()
  })
})

describe('Add to my Guardian Angels', () => {
  it('adds a template once, however quickly it is clicked', async () => {
    const agentic = connectedClient()
    let finish!: (result: AddAngelResult) => void
    agentic.addAngel.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    renderAt('/agentic/guardian-angel', agentic)
    const card = await screen.findByRole('article', { name: 'Elder Companion' })
    const button = within(card).getByRole('button', { name: /Add to my Guardian Angels/ })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(agentic.addAngel).toHaveBeenCalledTimes(1))
    fireEvent.click(within(card).getByRole('button', { name: /Adding/ }))
    await act(async () => finish({ status: 'added', angel: SAMPLE_ANGEL }))
    expect(await screen.findByText('Added Morning Check-in to My Guardian Angels.')).toBeInTheDocument()
    expect(agentic.addAngel).toHaveBeenCalledTimes(1)
    expect(agentic.addAngel).toHaveBeenCalledWith('7')
    fireEvent.click(screen.getByRole('button', { name: 'Show My Guardian Angels' }))
    expect(where()).toBe('/agentic/guardian-angel?tab=mine')
  })

  it('connects first when not connected, keeping the template to add', async () => {
    const agentic = renderAt('/agentic/guardian-angel')
    const card = await screen.findByRole('article', { name: 'Elder Companion' })
    fireEvent.click(within(card).getByRole('button', { name: /Add to my Guardian Angels/ }))
    await waitFor(() => expect(where()).toBe('/agentic/guardian-angel/view?page=connect&add=7'))
    expect(agentic.connect).toHaveBeenCalledTimes(1)
    expect(agentic.addAngel).not.toHaveBeenCalled()
  })

  it('finishes the add after connecting', async () => {
    const agentic = renderAt('/agentic/guardian-angel?tab=mine&add=7', connectedClient())
    expect(await screen.findByText('Added Morning Check-in to My Guardian Angels.')).toBeInTheDocument()
    expect(agentic.addAngel).toHaveBeenCalledTimes(1)
    expect(agentic.addAngel).toHaveBeenCalledWith('7')
    await waitFor(() => expect(where()).toBe('/agentic/guardian-angel?tab=mine'))
  })

  it('keeps the just-added angel when the first, older list arrives late', async () => {
    const agentic = connectedClient()
    let finishFirst!: (result: MyAngelsResult) => void
    agentic.getMyAngels
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
      .mockResolvedValueOnce({ status: 'ready', angels: [SAMPLE_ANGEL] })
    renderAt('/agentic/guardian-angel?tab=mine&add=7', agentic)
    expect(await screen.findByRole('article', { name: 'Morning Check-in' })).toBeInTheDocument()
    await act(async () => finishFirst({ status: 'ready', angels: [] }))
    expect(screen.getByRole('article', { name: 'Morning Check-in' })).toBeInTheDocument()
    expect(screen.queryByText('You have no Guardian Angels yet.')).not.toBeInTheDocument()
  })

  it('explains a template that is gone', async () => {
    const agentic = connectedClient()
    agentic.addAngel.mockResolvedValue({ status: 'not-found' })
    renderAt('/agentic/guardian-angel', agentic)
    const card = await screen.findByRole('article', { name: 'Elder Companion' })
    fireEvent.click(within(card).getByRole('button', { name: /Add to my Guardian Angels/ }))
    expect(await screen.findByText('That template is no longer available.')).toBeInTheDocument()
  })
})

describe('Talk with an angel', () => {
  it('offers Talk only for angels that run on this computer', async () => {
    const agentic = fakeAgenticClient()
    agentic.getAngelConnection.mockResolvedValue({ status: 'connected', email: 'pat@example.test' })
    agentic.getMyAngels.mockResolvedValue({ status: 'ready', angels: [SAMPLE_ANGEL, { ...SAMPLE_ANGEL, id: '6', name: 'Shift Notes', runsHere: false }] })
    renderAt('/agentic/guardian-angel?tab=mine', agentic)
    const talk = await screen.findAllByRole('button', { name: 'Talk' })
    expect(talk).toHaveLength(1)
    fireEvent.click(talk[0]!)
    expect(where()).toBe('/agentic/guardian-angel/chat?angel=5')
  })
})
