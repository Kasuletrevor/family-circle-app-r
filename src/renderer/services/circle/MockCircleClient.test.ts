import { describe, expect, it, vi } from 'vitest'
import { MockCircleClient } from './MockCircleClient'

describe('MockCircleClient', () => {
  it('provides a complete local home snapshot without using the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const client = new MockCircleClient()

    const snapshot = await client.getHomeSnapshot()
    const circles = await client.getMyCircles()

    expect(snapshot.state).toBe('ready')
    expect(snapshot.activeCircle.name).toBe('Kasule Family')
    expect(snapshot.metrics).toEqual({ members: 12, circles: 3, stories: 28, memories: 142 })
    expect(snapshot.people.some((person) => person.id === snapshot.selectedPersonId)).toBe(true)
    expect(snapshot.relationships.length).toBeGreaterThan(0)
    expect(snapshot.upcoming.length).toBeGreaterThan(0)
    expect(snapshot.activity.length).toBeGreaterThan(0)
    expect(circles).toHaveLength(3)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
