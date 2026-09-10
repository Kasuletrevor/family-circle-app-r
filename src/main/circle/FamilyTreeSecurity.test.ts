import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import { registerCircleIpc, type CircleIpcService } from './circleIpc'
import { CircleService } from './CircleService'
import type { CircleTreeInternal } from './circleModels'

const viewer: AuthUser = {
  id: 7,
  email: 'viewer@example.test',
  name: 'Viewer Example',
  accountOrigin: 'registered',
  mustChangePassword: false,
  onboardingCompleted: true,
}

function tree(ownerId = '88'): CircleTreeInternal {
  return {
    group: { id: 'g-1', name: 'Security Family', ownerId },
    people: [
      {
        id: 'user:88',
        kind: 'user',
        userId: '88',
        name: 'Viewer Example',
        email: 'viewer@example.test',
        role: ownerId === '88' ? 'Circle owner' : 'Family member',
      },
      {
        id: 'user:99',
        kind: 'user',
        userId: '99',
        name: 'Other Member',
        email: 'other@example.test',
        role: 'Family member',
      },
      {
        id: 'placeholder:1',
        kind: 'placeholder',
        userId: null,
        name: 'Legacy Relative',
        email: null,
        role: 'Grandparent',
      },
    ],
    relations: [],
    positions: [],
  }
}

function serviceHarness(options: { owner?: boolean; tree?: CircleTreeInternal } = {}) {
  const ownerId = options.owner === false ? 'owner:elsewhere' : '88'
  const activeTree = options.tree ?? tree(ownerId)
  const sessions = {
    restore: vi.fn(async () => viewer),
  }
  const users = {
    getRecordById: vi.fn(async () => ({
      user: viewer,
      passwordHash: 'hidden',
      serverUserId: '88',
      activeCircleId: 'g-1',
      sessionVersion: 0,
      invitation: null,
    })),
    setServerUserId: vi.fn(async () => undefined),
    setActiveCircleId: vi.fn(async () => undefined),
  }
  const port = {
    listGroups: vi.fn(async () => [{ id: 'g-1', name: 'Security Family', ownerId, role: ownerId === '88' ? 'Circle owner' : 'Family member' }]),
    getTree: vi.fn(async () => activeTree),
    getNotifications: vi.fn(async () => []),
    ensureSharedUser: vi.fn(async () => ({ serverUserId: '88' })),
    createCircle: vi.fn(async () => ({ id: 'created', name: 'Created', ownerId: '88', role: 'Circle owner' })),
    inviteMember: vi.fn(async () => ({ outcome: 'sent' as const })),
    addTreeRelation: vi.fn(async () => ({ success: true as const })),
    deleteTreeRelation: vi.fn(async () => ({ success: true as const })),
    saveTreePosition: vi.fn(async () => ({ success: true as const })),
    cancelInvitation: vi.fn(async () => ({ success: true as const })),
    removeMember: vi.fn(async () => ({ success: true as const })),
    leaveCircle: vi.fn(async () => ({ success: true as const })),
  }

  return { port, service: new CircleService(sessions, users, port) }
}

function mutationIpcHarness() {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()
  const service = {
    addTreeRelation: vi.fn(async () => ({ success: true as const })),
    deleteTreeRelation: vi.fn(async () => ({ success: true as const })),
    saveTreePosition: vi.fn(async () => ({ success: true as const })),
  } as unknown as CircleIpcService

  registerCircleIpc({
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
  }, service)

  return { handlers, service }
}

describe('Family Tree security boundaries', () => {
  it('does not let the renderer choose serverUserId for relationship creation', async () => {
    const { handlers, service } = mutationIpcHarness()
    const handler = handlers.get('circle:add-tree-relation')
    expect(handler).toBeDefined()

    await handler?.(null, {
      kind: 'sibling',
      aPersonId: 'user:88',
      bPersonId: 'user:99',
      serverUserId: 'attacker',
    })

    expect(service.addTreeRelation).toHaveBeenCalledWith({
      kind: 'sibling',
      aPersonId: 'user:88',
      bPersonId: 'user:99',
    })
  })

  it('does not let the renderer choose circleId for add, delete, or position writes', async () => {
    const { handlers, service } = mutationIpcHarness()

    await handlers.get('circle:add-tree-relation')?.(null, {
      kind: 'sibling',
      aPersonId: 'user:88',
      bPersonId: 'user:99',
      circleId: 'foreign',
    })
    await handlers.get('circle:delete-tree-relation')?.(null, {
      relationId: 'r-1',
      circleId: 'foreign',
    })
    await handlers.get('circle:save-tree-position')?.(null, {
      personId: 'user:88',
      x: 12,
      y: 34,
      circleId: 'foreign',
    })

    expect(service.addTreeRelation).toHaveBeenCalledWith({
      kind: 'sibling',
      aPersonId: 'user:88',
      bPersonId: 'user:99',
    })
    expect(service.deleteTreeRelation).toHaveBeenCalledWith({ relationId: 'r-1' })
    expect(service.saveTreePosition).toHaveBeenCalledWith({ personId: 'user:88', x: 12, y: 34 })
  })

  it('rejects a foreign-Circle person before relationship transport', async () => {
    const { service, port } = serviceHarness()

    await expect(service.addTreeRelation({
      kind: 'sibling',
      aPersonId: 'user:88',
      bPersonId: 'user:foreign',
    })).rejects.toThrow('confirmed Circle members')

    expect(port.addTreeRelation).not.toHaveBeenCalled()
  })

  it('rejects placeholder relationship creation before transport', async () => {
    const { service, port } = serviceHarness()

    await expect(service.addTreeRelation({
      kind: 'grandparent',
      aPersonId: 'placeholder:1',
      bPersonId: 'user:88',
    })).rejects.toThrow('confirmed Circle members')

    expect(port.addTreeRelation).not.toHaveBeenCalled()
  })

  it('rejects non-owner relationship writes before transport', async () => {
    const { service, port } = serviceHarness({ owner: false })

    await expect(service.addTreeRelation({
      kind: 'sibling',
      aPersonId: 'user:88',
      bPersonId: 'user:99',
    })).rejects.toThrow('Only the Circle owner')

    expect(port.addTreeRelation).not.toHaveBeenCalled()
  })

  it('prevents an ordinary member from moving another user node', async () => {
    const { service, port } = serviceHarness({ owner: false })

    await expect(service.saveTreePosition({
      personId: 'user:99',
      x: 10,
      y: 20,
    })).rejects.toThrow('only move your own')

    expect(port.saveTreePosition).not.toHaveBeenCalled()
  })

  it('allows the owner to move a confirmed member using main-derived identity and Circle', async () => {
    const { service, port } = serviceHarness()

    await expect(service.saveTreePosition({
      personId: 'user:99',
      x: 10,
      y: 20,
    })).resolves.toEqual({ success: true })

    expect(port.saveTreePosition).toHaveBeenCalledWith({
      serverUserId: '88',
      circleId: 'g-1',
      personId: 'user:99',
      x: 10,
      y: 20,
    })
  })

  it('rejects a stale or foreign relation ID before delete transport', async () => {
    const { service, port } = serviceHarness()

    await expect(service.deleteTreeRelation({ relationId: 'foreign-r' }))
      .rejects.toThrow('no longer in this Circle')

    expect(port.deleteTreeRelation).not.toHaveBeenCalled()
  })

  it('rejects a new ancestry cycle before relationship transport', async () => {
    const cyclicTree = tree()
    cyclicTree.relations = [
      { id: 'r-1', kind: 'mother', aPersonId: 'user:88', bPersonId: 'user:99' },
    ]
    const { service, port } = serviceHarness({ tree: cyclicTree })

    await expect(service.addTreeRelation({
      kind: 'father',
      aPersonId: 'user:99',
      bPersonId: 'user:88',
    })).rejects.toThrow('cycle')

    expect(port.addTreeRelation).not.toHaveBeenCalled()
  })

  it('keeps Family Tree mutations outside local SQLite and Vault persistence', () => {
    const migrations = readFileSync(new URL('../database/migrations.ts', import.meta.url), 'utf8')
    const serviceSource = readFileSync(new URL('./CircleService.ts', import.meta.url), 'utf8')

    expect(migrations).not.toMatch(/family[_ -]?tree|tree_(?:relations?|positions?)/i)
    expect(serviceSource).not.toMatch(/VaultRepository|DatabaseSync|node:sqlite/)
  })
})
