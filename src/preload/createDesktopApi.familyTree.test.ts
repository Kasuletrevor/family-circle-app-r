import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './createDesktopApi'

describe('createDesktopApi Family Tree surface', () => {
  it('exposes only safe Family Tree methods and invokes exact channels with safe payloads', async () => {
    const invoke = vi.fn(async () => ({ success: true as const }))
    const api = createDesktopApi(invoke)

    expect(Object.keys(api.circle)).toContain('addTreeRelation')
    expect(Object.keys(api.circle)).toContain('deleteTreeRelation')
    expect(Object.keys(api.circle)).toContain('saveTreePosition')

    await api.circle.addTreeRelation({
      kind: 'mother',
      aPersonId: 'user:1',
      bPersonId: 'user:2',
    })
    expect(invoke).toHaveBeenCalledWith('circle:add-tree-relation', {
      kind: 'mother',
      aPersonId: 'user:1',
      bPersonId: 'user:2',
    })

    await api.circle.deleteTreeRelation({ relationId: 'r-1' })
    expect(invoke).toHaveBeenCalledWith('circle:delete-tree-relation', { relationId: 'r-1' })

    await api.circle.saveTreePosition({ personId: 'user:2', x: 120, y: -50 })
    expect(invoke).toHaveBeenCalledWith('circle:save-tree-position', {
      personId: 'user:2',
      x: 120,
      y: -50,
    })

    expect(JSON.stringify(api.circle).toLowerCase()).not.toMatch(/serveruserid|localuserid|ownerid|fromuserid|apikey|backendurl/)
  })
})
