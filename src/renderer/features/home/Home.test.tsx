import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppServicesProvider, type AppServices } from '../../app/services'
import type { CircleClient } from '../../services/circle/CircleClient'
import { MockCircleClient } from '../../services/circle/MockCircleClient'
import { Home } from './Home'

function renderHome(circle: CircleClient) {
  const services: AppServices = { circle }
  return render(
    <AppServicesProvider services={services}>
      <Home />
    </AppServicesProvider>,
  )
}

describe('Home', () => {
  it('renders the Family Circle overview from the Circle service', async () => {
    renderHome(new MockCircleClient())

    expect(await screen.findByRole('heading', { name: /good .* trevor/i })).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('142')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Upcoming' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Family Tree' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Trevor Kasule' })).toBeInTheDocument()
    expect(screen.getByText("David's Birthday")).toBeInTheDocument()
    expect(screen.getByText('Jose accepted your invitation')).toBeInTheDocument()
  })

  it('shows an error state and retries the same service boundary', async () => {
    const snapshot = await new MockCircleClient().getHomeSnapshot()
    const getHomeSnapshot = vi
      .fn<CircleClient['getHomeSnapshot']>()
      .mockRejectedValueOnce(new Error('Circle service unavailable'))
      .mockResolvedValueOnce(snapshot)

    renderHome({
      getHomeSnapshot,
      getMyCircles: vi.fn(async () => [snapshot.activeCircle]),
    })

    expect(await screen.findByText('We could not load your family overview.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: /good .* trevor/i })).toBeInTheDocument()
    expect(getHomeSnapshot).toHaveBeenCalledTimes(2)
  })
})
