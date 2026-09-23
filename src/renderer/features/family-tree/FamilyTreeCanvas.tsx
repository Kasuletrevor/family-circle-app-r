import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import type { CircleTreePersonRecord, SaveTreePositionInput } from '../../../shared/desktopApi'
import { relationshipSentence } from './familyTreeLabels'
import {
  buildRelationshipPaths,
  type FamilyTreeLayout,
  type FamilyTreeLayoutNode,
  type FamilyTreePath,
} from './familyTreeLayout'
import './FamilyTree.css'

const NODE_WIDTH = 180
const NODE_HEIGHT = 84
const VIEWPORT_WIDTH = 900
const VIEWPORT_HEIGHT = 560
const MIN_SCALE = 0.25
const MAX_SCALE = 1.5
const ZOOM_FACTOR = 1.2

type Position = { x: number; y: number }
type ViewTransform = { scale: number; x: number; y: number }

type DragState = {
  personId: string
  pointerId: number
  startClientX: number
  startClientY: number
  startX: number
  startY: number
  currentX: number
  currentY: number
}

type PanState = {
  pointerId: number
  startClientX: number
  startClientY: number
  startX: number
  startY: number
}

export type FamilyTreeSelection =
  | { type: 'person'; personId: string }
  | { type: 'relation'; relationId: string }
  | null

export interface FamilyTreeCanvasProps {
  layout: FamilyTreeLayout
  paths: FamilyTreePath[]
  viewerPersonId: string | null
  viewerIsOwner: boolean
  selection: FamilyTreeSelection
  onSelectionChange(selection: FamilyTreeSelection): void
  onPositionChange(input: SaveTreePositionInput): Promise<void>
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

function visibleNodes(layout: FamilyTreeLayout): FamilyTreeLayoutNode[] {
  return layout.nodes.filter((node) => node.kind === 'user' || node.kind === 'placeholder')
}

function positionsFromLayout(layout: FamilyTreeLayout): Record<string, Position> {
  return Object.fromEntries(visibleNodes(layout).map((node) => [node.id, { x: node.x, y: node.y }]))
}

function handleAccessibleActivate(
  event: ReactKeyboardEvent<SVGElement>,
  activate: () => void,
): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  activate()
}

function relationAriaLabel(
  relationId: string,
  layout: FamilyTreeLayout,
): string {
  const relation = layout.edges.find((edge) => edge.id === relationId)
  if (!relation) return 'Select relationship'
  const byId = new Map(layout.nodes.map((node) => [node.id, node]))
  const a = byId.get(relation.aPersonId)?.name ?? 'Family member'
  const b = byId.get(relation.bPersonId)?.name ?? 'Family member'
  return `Select relationship ${a} and ${b}`
}

function fitTransform(nodes: FamilyTreeLayoutNode[]): ViewTransform {
  if (nodes.length === 0) return { scale: 1, x: 40, y: 40 }

  const minX = Math.min(...nodes.map((node) => node.x))
  const minY = Math.min(...nodes.map((node) => node.y))
  const maxX = Math.max(...nodes.map((node) => node.x + NODE_WIDTH))
  const maxY = Math.max(...nodes.map((node) => node.y + NODE_HEIGHT))
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const padding = 72
  const scale = clampScale(Math.min(
    (VIEWPORT_WIDTH - padding * 2) / width,
    (VIEWPORT_HEIGHT - padding * 2) / height,
  ))

  return {
    scale,
    x: (VIEWPORT_WIDTH - width * scale) / 2 - minX * scale,
    y: (VIEWPORT_HEIGHT - height * scale) / 2 - minY * scale,
  }
}

export function FamilyTreeCanvas({
  layout,
  paths,
  viewerPersonId,
  viewerIsOwner,
  selection,
  onSelectionChange,
  onPositionChange,
}: FamilyTreeCanvasProps) {
  const nodes = useMemo(() => visibleNodes(layout), [layout])
  const [localPositions, setLocalPositions] = useState<Record<string, Position>>(() => positionsFromLayout(layout))
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 48, y: 48 })
  const [saveError, setSaveError] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const panRef = useRef<PanState | null>(null)

  useEffect(() => {
    setLocalPositions(positionsFromLayout(layout))
    setSaveError(false)
    dragRef.current = null
    panRef.current = null
  }, [layout])

  const renderedLayout = useMemo<FamilyTreeLayout>(() => ({
    nodes: nodes.map((node) => ({ ...node, ...(localPositions[node.id] ?? { x: node.x, y: node.y }) })),
    edges: layout.edges,
  }), [layout.edges, localPositions, nodes])

  const renderedPathById = useMemo(() => new Map(
    buildRelationshipPaths(renderedLayout).map((path) => [path.relationId, path]),
  ), [renderedLayout])

  const renderedPaths = useMemo(() => paths.flatMap((path) => {
    const rendered = renderedPathById.get(path.relationId)
    return rendered ? [rendered] : []
  }), [paths, renderedPathById])

  const people = useMemo<CircleTreePersonRecord[]>(() => nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    name: node.name,
    email: node.email,
    role: node.role,
  })), [nodes])

  const relationshipSummary = useMemo(() => layout.edges.flatMap((edge) => {
    if (!nodes.some((node) => node.id === edge.aPersonId) || !nodes.some((node) => node.id === edge.bPersonId)) return []
    return [relationshipSentence(edge, people)]
  }), [layout.edges, nodes, people])

  function canDrag(node: FamilyTreeLayoutNode): boolean {
    return node.kind === 'user' && (viewerIsOwner || node.id === viewerPersonId)
  }

  function zoom(factor: number): void {
    setView((current) => ({ ...current, scale: clampScale(current.scale * factor) }))
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>): void {
    event.preventDefault()
    zoom(event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)
  }

  function handleNodePointerDown(event: ReactPointerEvent<SVGGElement>, node: FamilyTreeLayoutNode): void {
    if (!canDrag(node)) return
    event.preventDefault()
    setSaveError(false)
    const position = localPositions[node.id] ?? { x: node.x, y: node.y }
    dragRef.current = {
      personId: node.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: position.x,
      startY: position.y,
      currentX: position.x,
      currentY: position.y,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function handleStagePointerDown(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.target !== event.currentTarget) return
    panRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: view.x,
      startY: view.y,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    const drag = dragRef.current
    if (drag && drag.pointerId === event.pointerId) {
      const nextX = drag.startX + (event.clientX - drag.startClientX) / view.scale
      const nextY = drag.startY + (event.clientY - drag.startClientY) / view.scale
      drag.currentX = nextX
      drag.currentY = nextY
      setLocalPositions((current) => ({
        ...current,
        [drag.personId]: { x: nextX, y: nextY },
      }))
      return
    }

    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    setView((current) => ({
      ...current,
      x: pan.startX + event.clientX - pan.startClientX,
      y: pan.startY + event.clientY - pan.startClientY,
    }))
  }

  async function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>): Promise<void> {
    const drag = dragRef.current
    if (drag && drag.pointerId === event.pointerId) {
      dragRef.current = null
      const input: SaveTreePositionInput = {
        personId: drag.personId,
        x: drag.currentX,
        y: drag.currentY,
      }

      try {
        await onPositionChange(input)
        setSaveError(false)
      } catch {
        setLocalPositions((current) => ({
          ...current,
          [drag.personId]: { x: drag.startX, y: drag.startY },
        }))
        setSaveError(true)
      }
    }

    if (panRef.current?.pointerId === event.pointerId) panRef.current = null
  }

  return (
    <div className="family-tree-canvas">
      <div className="family-tree-canvas__toolbar" aria-label="Family tree view controls">
        <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / ZOOM_FACTOR)}>−</button>
        <button type="button" aria-label="Zoom in" onClick={() => zoom(ZOOM_FACTOR)}>+</button>
        <button type="button" aria-label="Fit family tree" onClick={() => setView(fitTransform(renderedLayout.nodes))}>Fit</button>
      </div>

      {saveError ? <p className="family-tree-canvas__error" role="alert">Could not save this position. Please try again.</p> : null}

      <div className="family-tree-canvas__stage">
        <svg
          className="family-tree-canvas__svg"
          data-testid="family-tree-svg"
          viewBox={`0 0 ${VIEWPORT_WIDTH} ${VIEWPORT_HEIGHT}`}
          aria-label="Interactive family tree"
          onWheel={handleWheel}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => { void handlePointerUp(event) }}
          onPointerCancel={(event) => { void handlePointerUp(event) }}
        >
          <g
            data-testid="family-tree-viewport"
            data-scale={view.scale}
            data-translate-x={view.x}
            data-translate-y={view.y}
            transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}
          >
            {renderedPaths.map((path) => {
              const selected = selection?.type === 'relation' && selection.relationId === path.relationId
              const ariaLabel = relationAriaLabel(path.relationId, renderedLayout)
              return (
                <g key={path.relationId}>
                  <path
                    className={`family-tree-canvas__relationship${selected ? ' family-tree-canvas__relationship--selected' : ''}`}
                    d={path.d}
                  />
                  <path
                    className="family-tree-canvas__relationship-hit"
                    d={path.d}
                    role="button"
                    tabIndex={0}
                    aria-label={ariaLabel}
                    aria-pressed={selected}
                    onClick={() => onSelectionChange({ type: 'relation', relationId: path.relationId })}
                    onKeyDown={(event) => handleAccessibleActivate(event, () => onSelectionChange({ type: 'relation', relationId: path.relationId }))}
                  />
                </g>
              )
            })}

            {renderedLayout.nodes.map((node) => {
              const selected = selection?.type === 'person' && selection.personId === node.id
              const draggable = canDrag(node)
              const isViewer = node.id === viewerPersonId
              const className = [
                'family-tree-canvas__node',
                selected ? 'family-tree-canvas__node--selected' : '',
                draggable ? 'family-tree-canvas__node--draggable' : '',
                node.kind === 'placeholder' ? 'family-tree-canvas__node--placeholder' : '',
              ].filter(Boolean).join(' ')

              return (
                <g
                  key={node.id}
                  className={className}
                  transform={`translate(${node.x} ${node.y})`}
                  data-x={node.x}
                  data-y={node.y}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select ${node.name}`}
                  aria-pressed={selected}
                  onClick={() => onSelectionChange({ type: 'person', personId: node.id })}
                  onKeyDown={(event) => handleAccessibleActivate(event, () => onSelectionChange({ type: 'person', personId: node.id }))}
                  onPointerDown={(event) => handleNodePointerDown(event, node)}
                >
                  <rect className="family-tree-canvas__node-card" width={NODE_WIDTH} height={NODE_HEIGHT} rx={12} />
                  <text className="family-tree-canvas__node-name" x={14} y={27}>{node.name}</text>
                  <text className="family-tree-canvas__node-role" x={14} y={48}>{node.role}</text>
                  {isViewer ? <text className="family-tree-canvas__badge" x={14} y={69}>You</text> : null}
                  {node.kind === 'placeholder' ? (
                    <text className="family-tree-canvas__badge family-tree-canvas__badge--record" x={14} y={69}>Family record</text>
                  ) : null}
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      <section className="family-tree-canvas__summary" aria-label="Relationship summary">
        <h3>Relationships</h3>
        {relationshipSummary.length > 0 ? (
          <ul>
            {relationshipSummary.map((summary, index) => <li key={`${index}-${summary}`}>{summary}</li>)}
          </ul>
        ) : <p>No relationships to display yet.</p>}
      </section>
    </div>
  )
}
