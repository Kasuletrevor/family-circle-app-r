import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildRelationshipPaths, type FamilyTreeLayout } from './familyTreeLayout'
import { FamilyTreeCanvas } from './FamilyTreeCanvas'

const layout: FamilyTreeLayout = {
  nodes: [
    {
      id: 'user:alice',
      kind: 'user',
      name: 'Alice',
      email: 'alice@example.test',
      role: 'Sibling',
      x: 0,
      y: 0,
      generation: 0,
      persisted: false,
    },
    {
      id: 'user:bob',
      kind: 'user',
      name: 'Bob',
      email: 'bob@example.test',
      role: 'Sibling',
      x: 280,
      y: 0,
      generation: 0,
      persisted: false,
    },
  ],
  edges: [
    { id: 'r-sibling', kind: 'sibling', aPersonId: 'user:alice', bPersonId: 'user:bob' },
  ],
}

function renderCanvas(selection: React.ComponentProps<typeof FamilyTreeCanvas>['selection']) {
  render(
    <FamilyTreeCanvas
      layout={layout}
      paths={buildRelationshipPaths(layout)}
      viewerPersonId="user:alice"
      viewerIsOwner
      selection={selection}
      onSelectionChange={vi.fn()}
      onPositionChange={vi.fn(async () => undefined)}
    />,
  )
}

describe('Family Tree accessibility polish', () => {
  it('gives every view control an explicit task-oriented accessible name', () => {
    renderCanvas(null)

    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Fit family tree' })).toBeEnabled()
  })

  it('exposes selected person state through ARIA instead of color alone', () => {
    renderCanvas({ type: 'person', personId: 'user:alice' })

    expect(screen.getByRole('button', { name: 'Select Alice' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Select Bob' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('exposes selected relationship state through ARIA instead of color alone', () => {
    renderCanvas({ type: 'relation', relationId: 'r-sibling' })

    const relationship = screen.getByRole('button', { name: 'Select relationship Alice and Bob' })
    expect(relationship).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(relationship, { key: 'Enter' })
  })
})
