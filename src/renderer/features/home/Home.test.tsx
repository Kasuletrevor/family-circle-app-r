import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CircleOverview } from '../../../shared/desktopApi'
import { AppServicesProvider, type AppServices } from '../../app/services'
import type { CircleClient } from '../../services/circle/CircleClient'
import { DesktopCircleClient } from '../../services/circle/DesktopCircleClient'
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

  it('shows an intentional empty state when the protected account has no shared Circle', async () => {
    const overview: CircleOverview = {
      status: 'empty',
      reason: 'no-circles',
      circles: [],
      activeCircleId: null,
      viewerPersonId: null,
      tree: null,
      notifications: [],
    }
    renderHome(new DesktopCircleClient(async () => overview) as unknown as CircleClient)

    expect(await screen.findByRole('heading', { name: 'No family circle yet' })).toBeInTheDocument()
    expect(screen.getByText(/create or join a family circle/i)).toBeInTheDocument()
    expect(screen.queryByText('We could not load your family overview.')).not.toBeInTheDocument()
  })

  it('renders real Circle data without fabricated Stories, Memories, or Upcoming content', async () => {
    const overview: CircleOverview = {
      status: 'ready',
      activeCircleId: 'g-1',
      viewerPersonId: 'user:88',
      circles: [{ id: 'g-1', name: 'Test Family', ownerId: '1', role: 'Family member' }],
      tree: {
        group: { id: 'g-1', name: 'Test Family', ownerId: '1' },
        people: [{
          id: 'user:88',
          kind: 'user',
          userId: '88',
          name: 'Member Example',
          email: 'member@example.test',
          role: 'Family member',
        }],
        relations: [],
        positions: [],
      },
      notifications: [{
        id: 'n-1',
        type: 'member_joined',
        title: 'A member joined Test Family',
        message: 'Membership changed.',
        groupId: 'g-1',
        groupName: 'Test Family',
        createdAt: Date.now(),
        read: false,
      }],
    }
    renderHome(new DesktopCircleClient(async () => overview) as unknown as CircleClient)

    expect(await screen.findByRole('heading', { name: /good .* member/i })).toBeInTheDocument()
    expect(screen.getByText('Test Family')).toBeInTheDocument()
    expect(screen.getByText('A member joined Test Family')).toBeInTheDocument()
    expect(screen.queryByText('Stories')).not.toBeInTheDocument()
    expect(screen.queryByText('Memories')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Upcoming' })).not.toBeInTheDocument()
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
