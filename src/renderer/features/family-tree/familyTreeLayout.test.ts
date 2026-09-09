import { describe, expect, it } from 'vitest'
import { TREE_COORDINATE_LIMIT } from '../../../shared/desktopApi'
import type { CircleTreeRecord } from '../../../shared/desktopApi'
import {
  assignFamilyGenerations,
  buildRelationshipPaths,
  layoutFamilyTree,
  normalizeFamilyGraph,
  type FamilyGraph,
} from './familyTreeLayout'

function node(id: string, kind: 'user' | 'placeholder' = 'user') {
  return { id, kind, name: id, email: null, role: 'Family member' }
}

function graph(nodes: FamilyGraph['nodes'], edges: FamilyGraph['edges']): FamilyGraph {
  return { nodes, edges }
}

describe('Family Tree layout engine', () => {
  it('filters invitation nodes and their edges while preserving legacy placeholders', () => {
    const tree: CircleTreeRecord = {
      group: { id: 'g-1', name: 'Family' },
      people: [
        node('user:a'),
        { id: 'invite:i-1', kind: 'invite', name: 'Pending', email: 'pending@example.test', role: 'Sibling' },
        node('placeholder:p-1', 'placeholder'),
      ],
      relations: [
        { id: 'r-visible', kind: 'sibling', aPersonId: 'user:a', bPersonId: 'placeholder:p-1' },
        { id: 'r-invite', kind: 'sibling', aPersonId: 'user:a', bPersonId: 'invite:i-1' },
      ],
      positions: [],
    }

    const normalized = normalizeFamilyGraph(tree)
    expect(normalized.nodes.map((item) => item.id)).toEqual(['user:a', 'placeholder:p-1'])
    expect(normalized.edges.map((item) => item.id)).toEqual(['r-visible'])
  })

  it('places parent-like sources one generation above their targets', () => {
    const family = graph(
      [node('user:parent'), node('user:child')],
      [{ id: 'r-1', kind: 'mother', aPersonId: 'user:parent', bPersonId: 'user:child' }],
    )
    const generations = assignFamilyGenerations(family)
    expect(generations.get('user:child')).toBe((generations.get('user:parent') ?? 0) + 1)
  })

  it('keeps siblings on the same inferred generation', () => {
    const family = graph(
      [node('user:parent'), node('user:child-a'), node('user:child-b')],
      [
        { id: 'r-parent-a', kind: 'father', aPersonId: 'user:parent', bPersonId: 'user:child-a' },
        { id: 'r-parent-b', kind: 'father', aPersonId: 'user:parent', bPersonId: 'user:child-b' },
        { id: 'r-sibling', kind: 'sibling', aPersonId: 'user:child-a', bPersonId: 'user:child-b' },
      ],
    )
    const generations = assignFamilyGenerations(family)
    expect(generations.get('user:child-a')).toBe(generations.get('user:child-b'))
  })

  it('keeps spouse nodes on the same generation and adjacent when practical', () => {
    const family = graph(
      [node('user:a'), node('user:m'), node('user:z')],
      [{ id: 'r-spouse', kind: 'spouse', aPersonId: 'user:a', bPersonId: 'user:z' }],
    )
    const generations = assignFamilyGenerations(family)
    expect(generations.get('user:a')).toBe(generations.get('user:z'))

    const layout = layoutFamilyTree(family, [])
    const a = layout.nodes.find((item) => item.id === 'user:a')!
    const z = layout.nodes.find((item) => item.id === 'user:z')!
    const m = layout.nodes.find((item) => item.id === 'user:m')!
    expect(Math.abs(a.x - z.x)).toBeLessThan(Math.abs(a.x - m.x))
  })

  it('lays out disconnected nodes instead of dropping them', () => {
    const family = graph([node('user:a'), node('user:b'), node('user:c')], [])
    const layout = layoutFamilyTree(family, [])
    expect(layout.nodes.map((item) => item.id).sort()).toEqual(['user:a', 'user:b', 'user:c'])
    expect(new Set(layout.nodes.map((item) => `${item.x}:${item.y}`)).size).toBe(3)
  })

  it('uses valid persisted positions as overrides', () => {
    const family = graph([node('user:a')], [])
    const layout = layoutFamilyTree(family, [{ personId: 'user:a', x: 1234, y: -5678 }])
    expect(layout.nodes[0]).toMatchObject({ x: 1234, y: -5678, persisted: true })
  })

  it('ignores persisted positions outside coordinate bounds', () => {
    const family = graph([node('user:a')], [])
    const layout = layoutFamilyTree(family, [{
      personId: 'user:a',
      x: TREE_COORDINATE_LIMIT + 1,
      y: 0,
    }])
    expect(layout.nodes[0].persisted).toBe(false)
    expect(layout.nodes[0].x).not.toBe(TREE_COORDINATE_LIMIT + 1)
  })

  it('returns identical coordinates for identical input', () => {
    const family = graph(
      [node('user:c'), node('user:a'), node('user:b')],
      [
        { id: 'r-parent', kind: 'mother', aPersonId: 'user:a', bPersonId: 'user:b' },
        { id: 'r-spouse', kind: 'spouse', aPersonId: 'user:a', bPersonId: 'user:c' },
      ],
    )
    expect(layoutFamilyTree(family, [])).toEqual(layoutFamilyTree(family, []))
  })

  it('terminates on malformed historical cycles and still lays out every visible node', () => {
    const family = graph(
      [node('user:a'), node('user:b')],
      [
        { id: 'r-a-b', kind: 'mother', aPersonId: 'user:a', bPersonId: 'user:b' },
        { id: 'r-b-a', kind: 'father', aPersonId: 'user:b', bPersonId: 'user:a' },
      ],
    )
    const generations = assignFamilyGenerations(family)
    expect(generations.size).toBe(2)
    const layout = layoutFamilyTree(family, [])
    expect(layout.nodes).toHaveLength(2)
    expect(layout.nodes.every((item) => Number.isFinite(item.x) && Number.isFinite(item.y))).toBe(true)
  })

  it('builds deterministic SVG path descriptors for visible relationships', () => {
    const family = graph(
      [node('user:a'), node('user:b')],
      [{ id: 'r-1', kind: 'sibling', aPersonId: 'user:a', bPersonId: 'user:b' }],
    )
    const layout = layoutFamilyTree(family, [])
    expect(buildRelationshipPaths(layout)).toEqual([
      expect.objectContaining({ relationId: 'r-1', kind: 'sibling', d: expect.stringMatching(/^M /) }),
    ])
  })
})
