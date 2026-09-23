import {
  TREE_COORDINATE_LIMIT,
  type CircleTreePositionRecord,
  type CircleTreeRecord,
  type CircleTreeRelationRecord,
} from '../../../shared/desktopApi'

const NODE_WIDTH = 180
const NODE_HEIGHT = 84
const H_GAP = 72
const V_GAP = 150

export type FamilyGraphNode = {
  id: string
  kind: 'user' | 'placeholder'
  name: string
  email: string | null
  role: string
}

export type FamilyGraphEdge = CircleTreeRelationRecord

export type FamilyGraph = {
  nodes: FamilyGraphNode[]
  edges: FamilyGraphEdge[]
}

export type FamilyTreeLayoutNode = FamilyGraphNode & {
  x: number
  y: number
  generation: number
  persisted: boolean
}

export type FamilyTreeLayout = {
  nodes: FamilyTreeLayoutNode[]
  edges: FamilyGraphEdge[]
}

export type FamilyTreePath = {
  relationId: string
  d: string
  kind: string
}

function generationDelta(kind: string): number | null {
  switch (kind) {
    case 'mother':
    case 'father':
    case 'guardian':
    case 'aunt_uncle':
      return 1
    case 'grandparent':
      return 2
    case 'spouse':
    case 'sibling':
    case 'cousin':
      return 0
    default:
      return null
  }
}

export function normalizeFamilyGraph(tree: CircleTreeRecord): FamilyGraph {
  const nodes: FamilyGraphNode[] = tree.people.flatMap((person) => {
    if (person.kind !== 'user' && person.kind !== 'placeholder') return []
    return [{
      id: person.id,
      kind: person.kind,
      name: person.name,
      email: person.email,
      role: person.role,
    }]
  })
  const visibleIds = new Set(nodes.map((item) => item.id))
  const edges = tree.relations
    .filter((edge) => visibleIds.has(edge.aPersonId) && visibleIds.has(edge.bPersonId))
    .map((edge) => ({ ...edge }))
  return { nodes, edges }
}

export function assignFamilyGenerations(graph: FamilyGraph): Map<string, number> {
  type Neighbor = { edgeId: string; personId: string; delta: number }
  const visibleIds = new Set(graph.nodes.map((node) => node.id))
  const neighbors = new Map<string, Neighbor[]>()

  for (const edge of graph.edges) {
    if (!visibleIds.has(edge.aPersonId) || !visibleIds.has(edge.bPersonId)) continue
    const delta = generationDelta(String(edge.kind))
    if (delta == null) continue

    const fromA = neighbors.get(edge.aPersonId) ?? []
    fromA.push({ edgeId: edge.id, personId: edge.bPersonId, delta })
    neighbors.set(edge.aPersonId, fromA)

    const fromB = neighbors.get(edge.bPersonId) ?? []
    fromB.push({ edgeId: edge.id, personId: edge.aPersonId, delta: -delta })
    neighbors.set(edge.bPersonId, fromB)
  }

  for (const values of neighbors.values()) {
    values.sort((left, right) => (
      left.edgeId.localeCompare(right.edgeId)
      || left.personId.localeCompare(right.personId)
      || left.delta - right.delta
    ))
  }

  const generations = new Map<string, number>()
  const nodeIds = [...visibleIds].sort((a, b) => a.localeCompare(b))

  for (const seed of nodeIds) {
    if (generations.has(seed)) continue
    generations.set(seed, 0)
    const queue = [seed]

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]
      const currentGeneration = generations.get(current) ?? 0
      for (const neighbor of neighbors.get(current) ?? []) {
        if (generations.has(neighbor.personId)) continue
        generations.set(neighbor.personId, currentGeneration + neighbor.delta)
        queue.push(neighbor.personId)
      }
    }
  }

  const minimum = generations.size > 0 ? Math.min(...generations.values()) : 0
  if (minimum < 0) {
    for (const [personId, generation] of generations) {
      generations.set(personId, generation - minimum)
    }
  }

  return generations
}

function validPersistedPosition(position: CircleTreePositionRecord): boolean {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && position.x >= -TREE_COORDINATE_LIMIT
    && position.x <= TREE_COORDINATE_LIMIT
    && position.y >= -TREE_COORDINATE_LIMIT
    && position.y <= TREE_COORDINATE_LIMIT
}

function spouseOrderedIds(
  ids: string[],
  edges: FamilyGraphEdge[],
  generations: Map<string, number>,
): string[] {
  const idSet = new Set(ids)
  const parent = new Map(ids.map((id) => [id, id]))

  const find = (id: string): string => {
    let current = id
    const visited: string[] = []
    while ((parent.get(current) ?? current) !== current) {
      visited.push(current)
      current = parent.get(current) ?? current
    }
    for (const item of visited) parent.set(item, current)
    return current
  }

  const union = (left: string, right: string): void => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot === rightRoot) return
    const [first, second] = [leftRoot, rightRoot].sort((a, b) => a.localeCompare(b))
    parent.set(second, first)
  }

  for (const edge of edges) {
    if (edge.kind !== 'spouse') continue
    if (!idSet.has(edge.aPersonId) || !idSet.has(edge.bPersonId)) continue
    if (generations.get(edge.aPersonId) !== generations.get(edge.bPersonId)) continue
    union(edge.aPersonId, edge.bPersonId)
  }

  const groups = new Map<string, string[]>()
  for (const id of [...ids].sort((a, b) => a.localeCompare(b))) {
    const root = find(id)
    const members = groups.get(root) ?? []
    members.push(id)
    groups.set(root, members)
  }

  return [...groups.values()]
    .map((members) => members.sort((a, b) => a.localeCompare(b)))
    .sort((left, right) => left[0].localeCompare(right[0]))
    .flat()
}

export function layoutFamilyTree(
  graph: FamilyGraph,
  positions: CircleTreePositionRecord[],
): FamilyTreeLayout {
  const generations = assignFamilyGenerations(graph)
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const idsByGeneration = new Map<number, string[]>()

  for (const node of graph.nodes) {
    const generation = generations.get(node.id) ?? 0
    const ids = idsByGeneration.get(generation) ?? []
    ids.push(node.id)
    idsByGeneration.set(generation, ids)
  }

  const automatic = new Map<string, { x: number; y: number; generation: number }>()
  const orderedGenerations = [...idsByGeneration.keys()].sort((a, b) => a - b)
  for (const generation of orderedGenerations) {
    const ids = spouseOrderedIds(idsByGeneration.get(generation) ?? [], graph.edges, generations)
    ids.forEach((personId, index) => {
      automatic.set(personId, {
        x: index * (NODE_WIDTH + H_GAP),
        y: generation * (NODE_HEIGHT + V_GAP),
        generation,
      })
    })
  }

  const persisted = new Map<string, CircleTreePositionRecord>()
  for (const position of positions) {
    if (!nodesById.has(position.personId) || persisted.has(position.personId)) continue
    if (validPersistedPosition(position)) persisted.set(position.personId, position)
  }

  const nodes: FamilyTreeLayoutNode[] = orderedGenerations.flatMap((generation) => {
    const ids = spouseOrderedIds(idsByGeneration.get(generation) ?? [], graph.edges, generations)
    return ids.flatMap((personId) => {
      const node = nodesById.get(personId)
      const auto = automatic.get(personId)
      if (!node || !auto) return []
      const saved = persisted.get(personId)
      return [{
        ...node,
        x: saved?.x ?? auto.x,
        y: saved?.y ?? auto.y,
        generation,
        persisted: Boolean(saved),
      }]
    })
  })

  return { nodes, edges: graph.edges.map((edge) => ({ ...edge })) }
}

export function buildRelationshipPaths(layout: FamilyTreeLayout): FamilyTreePath[] {
  const byId = new Map(layout.nodes.map((node) => [node.id, node]))

  return layout.edges.flatMap((edge) => {
    const from = byId.get(edge.aPersonId)
    const to = byId.get(edge.bPersonId)
    if (!from || !to) return []

    const startX = from.x + NODE_WIDTH / 2
    const startY = from.y + NODE_HEIGHT / 2
    const endX = to.x + NODE_WIDTH / 2
    const endY = to.y + NODE_HEIGHT / 2
    const midX = (startX + endX) / 2
    const d = `M ${startX} ${startY} C ${midX} ${startY} ${midX} ${endY} ${endX} ${endY}`

    return [{ relationId: edge.id, d, kind: edge.kind }]
  })
}
