import { describe, expect, it } from 'vitest'
import { MockCircleClient } from './MockCircleClient'

describe('MockCircleClient Family Tree writes', () => {
  it('supports deterministic safe tree mutations without network access', async () => {
    const client = new MockCircleClient()

    await expect(client.addTreeRelation({
      kind: 'sibling',
      aPersonId: 'trevor',
      bPersonId: 'jane',
    })).resolves.toEqual({ success: true })

    await expect(client.deleteTreeRelation('rel-john-jane')).resolves.toEqual({ success: true })
    await expect(client.saveTreePosition({ personId: 'trevor', x: 120, y: 240 })).resolves.toEqual({ success: true })
  })
})
