import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SaveTreePositionInput } from '../../../shared/desktopApi'
import { buildRelationshipPaths, type FamilyTreeLayout } from './familyTreeLayout'
import { FamilyTreeCanvas, type FamilyTreeCanvasProps } from './FamilyTreeCanvas'

const baseLayout: FamilyTreeLayout = {
  nodes: [
    {
      id: 'user:alice', kind: 'user', name: 'Alice', email: 'alice@example.test', role: 'Mother',
      x: 0, y: 0, generation: 0, persisted: false,
    },
    {
      id: 'user:bob', kind: 'user', name: 'Bob', email: 'bob@example.test', role: 'Sibling',
      x: 280, y: 0, generation: 0, persisted: false,
    },
    {
      id: 'placeholder:legacy', kind: 'placeholder', name: 'Legacy Relative', email: null, role: 'Grandparent',
      x: 0, y: 240, generation: 1, persisted: false,
    },
  ],
  edges: [
    { id: 'r-sibling', kind: 'sibling', aPersonId: 'user:alice', bPersonId: 'user:bob' },
    { id: 'r-legacy', kind: 'grandparent', aPersonId: 'placeholder:legacy', bPersonId: 'user:alice' },
  ],
}

const basePaths = buildRelationshipPaths(baseLayout)

function renderCanvas(options: {
  layout?: FamilyTreeLayout
  viewerPersonId?: string | null
  viewerIsOwner?: boolean
  onSelectionChange?: FamilyTreeCanvasProps['onSelectionChange']
  onPositionChange?: (input: SaveTreePositionInput) => Promise<void>
} = {}) {
  const onSelectionChange = options.onSelectionChange ?? vi.fn<FamilyTreeCanvasProps['onSelectionChange']>()
  const onPositionChange = options.onPositionChange ?? vi.fn(async (_input: SaveTreePositionInput) => undefined)
  const layout = options.layout ?? baseLayout
  render(
    <FamilyTreeCanvas
      layout={layout}
      paths={buildRelationshipPaths(layout)}
      viewerPersonId={options.viewerPersonId === undefined ? 'user:alice' : options.viewerPersonId}
      viewerIsOwner={options.viewerIsOwner ?? false}
      selection={null}
      onSelectionChange={onSelectionChange}
      onPositionChange={onPositionChange}
    />,
  )
  return { onSelectionChange, onPositionChange }
}

function drag(node: HTMLElement, xDelta: number, yDelta: number) {
  const svg = screen.getByTestId('family-tree-svg')
  fireEvent.pointerDown(node, { pointerId: 1, clientX: 100, clientY: 100 })
  fireEvent.pointerMove(svg, { pointerId: 1, clientX: 100 + xDelta, clientY: 100 + yDelta })
  return svg
}

describe('FamilyTreeCanvas', () => {
  it('renders confirmed users and read-only placeholders but defensively hides invite nodes', () => {
    const layoutWithInvite = {
      ...baseLayout,
      nodes: [
        ...baseLayout.nodes,
        {
          id: 'invite:i-1', kind: 'invite', name: 'Pending Person', email: 'pending@example.test', role: 'Sibling',
          x: 560, y: 0, generation: 0, persisted: false,
        } as unknown as FamilyTreeLayout['nodes'][number],
      ],
    }
    renderCanvas({ layout: layoutWithInvite })

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Legacy Relative')).toBeInTheDocument()
    expect(screen.getByText('Family record')).toBeInTheDocument()
    expect(screen.queryByText('Pending Person')).not.toBeInTheDocument()
  })

  it('marks the viewer node with visible You text', () => {
    renderCanvas()
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('selects a person node on click', () => {
    const { onSelectionChange } = renderCanvas()
    fireEvent.click(screen.getByRole('button', { name: 'Select Alice' }))
    expect(onSelectionChange).toHaveBeenCalledWith({ type: 'person', personId: 'user:alice' })
  })

  it('selects a relationship through a keyboard-focusable path overlay', () => {
    const { onSelectionChange } = renderCanvas()
    fireEvent.click(screen.getByRole('button', { name: 'Select relationship Alice and Bob' }))
    expect(onSelectionChange).toHaveBeenCalledWith({ type: 'relation', relationId: 'r-sibling' })
  })

  it('zoom controls adjust the viewport transform', () => {
    renderCanvas()
    const viewport = screen.getByTestId('family-tree-viewport')
    const initialScale = Number(viewport.getAttribute('data-scale'))
    const initialTransform = viewport.getAttribute('transform')

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(Number(viewport.getAttribute('data-scale'))).toBeGreaterThan(initialScale)
    expect(viewport.getAttribute('transform')).not.toBe(initialTransform)

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(Number(viewport.getAttribute('data-scale'))).toBeLessThanOrEqual(initialScale * 1.001)
  })

  it('fit restores a finite bounded transform containing the tree', () => {
    renderCanvas()
    const viewport = screen.getByTestId('family-tree-viewport')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fit tree' }))

    const scale = Number(viewport.getAttribute('data-scale'))
    expect(scale).toBeGreaterThanOrEqual(0.25)
    expect(scale).toBeLessThanOrEqual(1.5)
    expect(Number.isFinite(Number(viewport.getAttribute('data-translate-x')))).toBe(true)
    expect(Number.isFinite(Number(viewport.getAttribute('data-translate-y')))).toBe(true)
  })

  it('lets an owner drag a confirmed user and persists exactly once on pointer-up', async () => {
    const onPositionChange = vi.fn(async (_input: SaveTreePositionInput) => undefined)
    renderCanvas({ viewerIsOwner: true, onPositionChange })
    const alice = screen.getByRole('button', { name: 'Select Alice' })
    const originalX = Number(alice.getAttribute('data-x'))
    const svg = drag(alice, 60, 30)

    expect(onPositionChange).not.toHaveBeenCalled()
    expect(Number(alice.getAttribute('data-x'))).toBeGreaterThan(originalX)

    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 160, clientY: 130 })
    await waitFor(() => expect(onPositionChange).toHaveBeenCalledTimes(1))
    expect(onPositionChange).toHaveBeenCalledWith(expect.objectContaining({
      personId: 'user:alice',
      x: expect.any(Number),
      y: expect.any(Number),
    }))
  })

  it('lets an ordinary member drag only the viewer node', async () => {
    const onPositionChange = vi.fn(async (_input: SaveTreePositionInput) => undefined)
    renderCanvas({ viewerPersonId: 'user:alice', viewerIsOwner: false, onPositionChange })

    const bob = screen.getByRole('button', { name: 'Select Bob' })
    const bobSvg = drag(bob, 40, 20)
    fireEvent.pointerUp(bobSvg, { pointerId: 1, clientX: 140, clientY: 120 })
    expect(onPositionChange).not.toHaveBeenCalled()

    const alice = screen.getByRole('button', { name: 'Select Alice' })
    const aliceSvg = drag(alice, 40, 20)
    fireEvent.pointerUp(aliceSvg, { pointerId: 1, clientX: 140, clientY: 120 })
    await waitFor(() => expect(onPositionChange).toHaveBeenCalledTimes(1))
    expect(onPositionChange.mock.calls[0][0].personId).toBe('user:alice')
  })

  it('never lets a legacy placeholder node drag', () => {
    const onPositionChange = vi.fn(async (_input: SaveTreePositionInput) => undefined)
    renderCanvas({ viewerIsOwner: true, onPositionChange })
    const legacy = screen.getByRole('button', { name: 'Select Legacy Relative' })
    const svg = drag(legacy, 80, 40)
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 180, clientY: 140 })
    expect(onPositionChange).not.toHaveBeenCalled()
  })

  it('rolls back the local node position when persistence rejects', async () => {
    const onPositionChange = vi.fn(async (_input: SaveTreePositionInput) => {
      throw new Error('backend details')
    })
    renderCanvas({ viewerIsOwner: true, onPositionChange })
    const alice = screen.getByRole('button', { name: 'Select Alice' })
    const originalX = Number(alice.getAttribute('data-x'))
    const originalY = Number(alice.getAttribute('data-y'))
    const svg = drag(alice, 90, 45)
    expect(Number(alice.getAttribute('data-x'))).not.toBe(originalX)

    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 190, clientY: 145 })
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this position')
    await waitFor(() => {
      expect(Number(alice.getAttribute('data-x'))).toBe(originalX)
      expect(Number(alice.getAttribute('data-y'))).toBe(originalY)
    })
    expect(screen.queryByText(/backend details/i)).not.toBeInTheDocument()
  })

  it('provides a textual relationship summary in addition to SVG graphics', () => {
    renderCanvas()
    const summary = screen.getByLabelText('Relationship summary')
    expect(within(summary).getByText(/Alice.*sibling.*Bob/i)).toBeInTheDocument()
    expect(within(summary).getByText(/Legacy Relative.*grandparent.*Alice/i)).toBeInTheDocument()
    expect(basePaths).toHaveLength(2)
  })
})
