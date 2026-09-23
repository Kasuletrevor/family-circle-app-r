# Family Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/family-tree` placeholder with a secure shared Family Tree for the active Circle, including deterministic SVG layout, owner-only relationship CRUD, safe person/relation inspection, Circle switching, and persisted permitted node positions.

**Architecture:** Family Tree extends the existing Circle read/write path. Shared Circle membership, relationships, and node positions remain authoritative on the shared Circle service through `LegacyCircleAuthAdapter`; Electron main derives identity and active Circle, validates all mutations, and exposes only a narrow safe IPC contract. Renderer layout is pure TypeScript and rendering is React + SVG with no graph dependency.

**Tech Stack:** Electron 44, TypeScript, React, React Router, Vitest, Testing Library, Node/Electron IPC, existing Circle adapter/service stack, pure SVG.

**Spec:** `docs/superpowers/specs/2026-09-09-family-tree-design.md`

## Global Constraints

- Do not add Family Tree SQLite tables or local relationship persistence.
- Shared Circle service remains the single source of truth for people, relations, and persisted positions.
- Do not add D3, vis.js, React Flow, ELK, or another graph/layout dependency.
- Renderer must never supply `serverUserId`, `localUserId`, owner ID, backend URL, API key, or transport headers.
- Only confirmed `kind: 'user'` nodes may participate in v1 relationship mutations.
- Legacy `kind: 'placeholder'` nodes may render read-only but cannot be created, edited, deleted, related, or moved in v1.
- Pending `kind: 'invite'` nodes must not render on the tree canvas or participate in relations.
- Relationship creation kinds are exactly `mother | father | guardian | grandparent | spouse | sibling | aunt_uncle | cousin`.
- Existing legacy `friend` relations remain readable but are never creatable in v1.
- `mother`, `father`, `guardian`, `grandparent`, and `aunt_uncle` are directional; `spouse`, `sibling`, and `cousin` are canonicalized as undirected.
- New ancestry writes must reject cycles. The ancestry graph for cycle checks is `mother | father | guardian | grandparent`.
- `TREE_COORDINATE_LIMIT = 100_000`; both coordinates must be finite and inside `[-100000, 100000]` inclusive.
- Position persistence happens once on drag end/pointer-up, not continuously during pointer movement.
- Relationship mutations and successful position writes refetch or reconcile against authoritative server data; never treat renderer optimistic relation state as authoritative.
- Public overview includes safe `viewerIsOwner: boolean`; no owner ID crosses the bridge.
- Keep existing Circle invitation/member semantics unchanged.
- Use TDD for every production behavior change: failing test, observed RED, minimal implementation, GREEN, commit.

---

## File Structure

### Main/shared boundary

- Modify `src/shared/desktopApi.ts` — strict Family Tree mutation types and safe `viewerIsOwner` capability.
- Create `src/main/circle/familyTreeRules.ts` — relationship normalization, duplicate checks, ancestry-cycle validation, coordinate validation.
- Create `src/main/circle/familyTreeRules.test.ts` — pure main-process rule tests.
- Modify `src/main/circle/CircleService.ts` — derive owner capability and enforce active-Circle mutation authorization/integrity.
- Modify `src/main/circle/CircleService.test.ts` — service-level security and mutation tests.
- Modify `src/main/circle/LegacyCircleAuthAdapter.ts` — map tree writes to existing Jose/shared Circle endpoints.
- Modify `src/main/circle/LegacyCircleManagementAdapter.test.ts` — exact legacy endpoint/body tests for tree writes.
- Modify `src/main/circle/circleIpc.ts` — register safe Family Tree mutation channels and reconstruct inputs.
- Modify `src/main/circle/circleIpc.test.ts` — IPC contract and identity-injection tests.
- Modify `src/preload/createDesktopApi.ts` — expose narrow Circle tree methods.
- Modify `src/preload/createDesktopApi.test.ts` — approved surface + input reconstruction tests.

### Renderer service boundary

- Modify `src/renderer/services/circle/CircleClient.ts` — add Family Tree methods used by the feature.
- Modify `src/renderer/services/circle/DesktopCircleClient.ts` — implement methods only through `window.familyCircle.circle`.
- Modify `src/renderer/services/circle/DesktopCircleClient.test.ts` — bridge call tests.
- Modify `src/renderer/services/circle/MockCircleClient.ts` and `MockCircleClient.test.ts` — deterministic feature fixtures/mutations for renderer tests.
- Modify `src/renderer/services/circle/types.ts` only where renderer-specific snapshot/helper types are needed; do not duplicate shared public contract types unnecessarily.

### Family Tree feature

- Create `src/renderer/features/family-tree/familyTreeLayout.ts` — pure normalization/generation/layout/path logic.
- Create `src/renderer/features/family-tree/familyTreeLayout.test.ts` — deterministic layout tests.
- Create `src/renderer/features/family-tree/familyTreeLabels.ts` — pure plain-language/inverse relationship labels for inspectors/forms.
- Create `src/renderer/features/family-tree/familyTreeLabels.test.ts` — direction/inverse label tests.
- Create `src/renderer/features/family-tree/FamilyTreeCanvas.tsx` — SVG canvas, selection, pan/zoom, permitted dragging.
- Create `src/renderer/features/family-tree/FamilyTreeCanvas.test.tsx` — canvas interaction/accessibility tests.
- Create `src/renderer/features/family-tree/FamilyTreePage.tsx` — data loading, Circle selection, inspector, add/delete workflows, safe states.
- Create `src/renderer/features/family-tree/FamilyTreePage.test.tsx` — page/integration behavior.
- Create `src/renderer/features/family-tree/FamilyTree.css` — feature styles consistent with existing design system.
- Modify `src/renderer/app/App.tsx` and its route test if present — replace placeholder route with `FamilyTreePage`.

### Security regression

- Create `src/main/circle/FamilyTreeSecurity.test.ts` — focused cross-Circle/identity/foreign-ID security regression suite.

---

### Task 1: Lock the shared Family Tree contract and pure relationship rules

**Files:**
- Modify: `src/shared/desktopApi.ts`
- Create: `src/main/circle/familyTreeRules.ts`
- Create: `src/main/circle/familyTreeRules.test.ts`
- Modify: `src/main/circle/CircleService.test.ts` only for compile fixtures that now require `viewerIsOwner`

**Interfaces:**
- Produces:

```ts
export const FAMILY_RELATIONSHIP_KINDS = [
  'mother',
  'father',
  'guardian',
  'grandparent',
  'spouse',
  'sibling',
  'aunt_uncle',
  'cousin',
] as const

export type FamilyRelationshipKind = typeof FAMILY_RELATIONSHIP_KINDS[number]

export interface AddTreeRelationInput {
  kind: FamilyRelationshipKind
  aPersonId: string
  bPersonId: string
}

export interface SaveTreePositionInput {
  personId: string
  x: number
  y: number
}

export const TREE_COORDINATE_LIMIT = 100_000
```

- `CircleOverview` empty and ready variants both gain `viewerIsOwner: boolean`.
- `familyTreeRules.ts` exports:

```ts
export function canonicalizeTreeRelation(input: AddTreeRelationInput): AddTreeRelationInput
export function validateTreeRelation(
  input: AddTreeRelationInput,
  people: CircleTreePersonRecord[],
  relations: CircleTreeRelationRecord[],
): AddTreeRelationInput
export function validateTreePosition(input: SaveTreePositionInput): SaveTreePositionInput
```

- `validateTreeRelation` throws safe domain errors for unsupported/self/foreign/placeholder/duplicate/cyclic writes.

- [ ] **Step 1: Write failing relationship-rule tests**

Cover exact behaviors:

```ts
it('canonicalizes undirected spouse endpoints', () => {
  expect(canonicalizeTreeRelation({ kind: 'spouse', aPersonId: 'user:9', bPersonId: 'user:2' }))
    .toEqual({ kind: 'spouse', aPersonId: 'user:2', bPersonId: 'user:9' })
})

it('keeps directed mother endpoints in semantic order', () => {
  expect(canonicalizeTreeRelation({ kind: 'mother', aPersonId: 'user:9', bPersonId: 'user:2' }))
    .toEqual({ kind: 'mother', aPersonId: 'user:9', bPersonId: 'user:2' })
})

it('rejects relation endpoints that are not confirmed user nodes', () => {
  expect(() => validateTreeRelation(
    { kind: 'sibling', aPersonId: 'user:1', bPersonId: 'placeholder:p1' },
    [
      { id: 'user:1', kind: 'user', name: 'A', email: null, role: 'Member' },
      { id: 'placeholder:p1', kind: 'placeholder', name: 'B', email: null, role: '' },
    ],
    [],
  )).toThrow('Choose confirmed Circle members')
})

it('rejects duplicate symmetric relationships regardless of endpoint order', () => {
  expect(() => validateTreeRelation(
    { kind: 'sibling', aPersonId: 'user:2', bPersonId: 'user:1' },
    userPeople,
    [{ id: 'r1', kind: 'sibling', aPersonId: 'user:1', bPersonId: 'user:2' }],
  )).toThrow('That relationship already exists')
})

it('rejects an ancestry edge that would close a cycle', () => {
  const relations = [
    { id: 'r1', kind: 'mother', aPersonId: 'user:1', bPersonId: 'user:2' },
    { id: 'r2', kind: 'father', aPersonId: 'user:2', bPersonId: 'user:3' },
  ]
  expect(() => validateTreeRelation(
    { kind: 'guardian', aPersonId: 'user:3', bPersonId: 'user:1' },
    userPeople,
    relations,
  )).toThrow('That relationship would create an ancestry loop')
})

it('accepts finite coordinate bounds and rejects out-of-range values', () => {
  expect(validateTreePosition({ personId: 'user:1', x: 100000, y: -100000 }))
    .toEqual({ personId: 'user:1', x: 100000, y: -100000 })
  expect(() => validateTreePosition({ personId: 'user:1', x: 100001, y: 0 }))
    .toThrow('Choose a valid tree position')
})
```

- [ ] **Step 2: Run the new rule test file and verify RED**

Run:

```bash
npx vitest run src/main/circle/familyTreeRules.test.ts
```

Expected: FAIL because the new module/types do not yet exist.

- [ ] **Step 3: Implement strict shared types and pure rules**

Use endpoint canonicalization only for `spouse`, `sibling`, and `cousin`. For ancestry cycle detection, construct adjacency from existing `mother`, `father`, `guardian`, and `grandparent` edges and reject new `A -> B` when DFS/BFS from `B` reaches `A`. Use a visited set so malformed historical cycles always terminate.

Core shape:

```ts
const UNDIRECTED = new Set<FamilyRelationshipKind>(['spouse', 'sibling', 'cousin'])
const ANCESTRY = new Set(['mother', 'father', 'guardian', 'grandparent'])

export function canonicalizeTreeRelation(input: AddTreeRelationInput): AddTreeRelationInput {
  const aPersonId = String(input.aPersonId ?? '').trim()
  const bPersonId = String(input.bPersonId ?? '').trim()
  if (UNDIRECTED.has(input.kind) && aPersonId.localeCompare(bPersonId) > 0) {
    return { ...input, aPersonId: bPersonId, bPersonId: aPersonId }
  }
  return { ...input, aPersonId, bPersonId }
}
```

- [ ] **Step 4: Run focused tests and existing CircleService tests**

```bash
npx vitest run src/main/circle/familyTreeRules.test.ts src/main/circle/CircleService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/shared/desktopApi.ts src/main/circle/familyTreeRules.ts src/main/circle/familyTreeRules.test.ts src/main/circle/CircleService.test.ts
git commit -m "feat: define Family Tree relationship rules"
```

---

### Task 2: Map Family Tree mutations through the existing legacy Circle adapter

**Files:**
- Modify: `src/main/circle/CircleService.ts` — extend `CirclePort` interface signatures only in this task
- Modify: `src/main/circle/LegacyCircleAuthAdapter.ts`
- Modify: `src/main/circle/LegacyCircleManagementAdapter.test.ts`

**Interfaces:**
- Consumes: `FamilyRelationshipKind` from Task 1.
- Produces these `CirclePort` methods:

```ts
addTreeRelation(input: {
  serverUserId: string
  circleId: string
  kind: FamilyRelationshipKind
  aPersonId: string
  bPersonId: string
}): Promise<{ success: true }>

deleteTreeRelation(input: {
  serverUserId: string
  circleId: string
  relationId: string
}): Promise<{ success: true }>

saveTreePosition(input: {
  serverUserId: string
  circleId: string
  personId: string
  x: number
  y: number
}): Promise<{ success: true }>
```

- Adapter endpoint mappings are exactly:
  - `POST /api/group/:circleId/relation/add` body `{ fromUserId, kind, aPersonId, bPersonId }`
  - `POST /api/group/:circleId/relation/delete` body `{ fromUserId, relationId }`
  - `POST /api/group/:circleId/node/pos` body `{ fromUserId, personId, x, y }`

- [ ] **Step 1: Add failing exact request-shape tests**

```ts
await adapter.addTreeRelation({
  serverUserId: '88', circleId: 'g-1', kind: 'mother', aPersonId: 'user:88', bPersonId: 'user:99',
})
await adapter.deleteTreeRelation({ serverUserId: '88', circleId: 'g-1', relationId: 'r-1' })
await adapter.saveTreePosition({ serverUserId: '88', circleId: 'g-1', personId: 'user:99', x: 120, y: -50 })

expect(calls).toEqual([
  { path: '/api/group/g-1/relation/add', body: { fromUserId: '88', kind: 'mother', aPersonId: 'user:88', bPersonId: 'user:99' } },
  { path: '/api/group/g-1/relation/delete', body: { fromUserId: '88', relationId: 'r-1' } },
  { path: '/api/group/g-1/node/pos', body: { fromUserId: '88', personId: 'user:99', x: 120, y: -50 } },
])
```

- [ ] **Step 2: Run adapter test and verify RED**

```bash
npx vitest run src/main/circle/LegacyCircleManagementAdapter.test.ts
```

Expected: FAIL because methods are absent.

- [ ] **Step 3: Implement methods in `LegacyCircleAuthAdapter` using the existing POST helper/fetch pattern**

Do not create a second adapter class. Preserve existing API-key and error normalization behavior.

- [ ] **Step 4: Run adapter tests**

```bash
npx vitest run src/main/circle/LegacyCircleManagementAdapter.test.ts src/main/circle/LegacyCircleAuthAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/main/circle/CircleService.ts src/main/circle/LegacyCircleAuthAdapter.ts src/main/circle/LegacyCircleManagementAdapter.test.ts
git commit -m "feat: add shared Family Tree writes"
```

---

### Task 3: Enforce owner, active-Circle, foreign-ID, cycle, and position rules in `CircleService`

**Files:**
- Modify: `src/main/circle/CircleService.ts`
- Modify: `src/main/circle/CircleService.test.ts`
- Modify: `src/shared/desktopApi.ts` only if test fixture typing reveals a missed `viewerIsOwner` branch

**Interfaces:**
- Consumes: `validateTreeRelation`, `canonicalizeTreeRelation`, `validateTreePosition`.
- Produces service methods:

```ts
addTreeRelation(input: AddTreeRelationInput): Promise<{ success: true }>
deleteTreeRelation(input: { relationId: string }): Promise<{ success: true }>
saveTreePosition(input: SaveTreePositionInput): Promise<{ success: true }>
```

- `getOverview()` returns `viewerIsOwner: false` for empty states and derives `viewerIsOwner` from internal `tree.group.ownerId === serverUserId` for ready state.

- [ ] **Step 1: Write failing overview/authorization/mutation tests**

Required cases:

```ts
expect((await service.getOverview()).viewerIsOwner).toBe(true)
```

for an owner fixture, plus:

```ts
await expect(nonOwnerService.addTreeRelation({
  kind: 'sibling', aPersonId: 'user:2', bPersonId: 'user:3',
})).rejects.toThrow('Only the Circle owner can manage relationships')
```

and foreign/stale cases:

```ts
await expect(ownerService.addTreeRelation({
  kind: 'sibling', aPersonId: 'user:2', bPersonId: 'user:foreign',
})).rejects.toThrow('Choose confirmed Circle members')

await expect(ownerService.deleteTreeRelation({ relationId: 'missing-r' }))
  .rejects.toThrow('That relationship is no longer in this Circle')
```

Position permission cases:

```ts
await expect(memberService.saveTreePosition({ personId: viewerPersonId, x: 50, y: 75 }))
  .resolves.toEqual({ success: true })
await expect(memberService.saveTreePosition({ personId: 'user:someone-else', x: 50, y: 75 }))
  .rejects.toThrow('You can only move your own family tree card')
await expect(ownerService.saveTreePosition({ personId: 'user:someone-else', x: 50, y: 75 }))
  .resolves.toEqual({ success: true })
```

Also prove placeholders cannot move and out-of-range coordinates never reach the adapter.

- [ ] **Step 2: Run CircleService tests and verify RED**

```bash
npx vitest run src/main/circle/CircleService.test.ts
```

Expected: FAIL on missing methods/capability.

- [ ] **Step 3: Implement service methods by reusing `requireActiveCircleContext()`**

Implementation pattern:

```ts
async addTreeRelation(input: AddTreeRelationInput): Promise<{ success: true }> {
  const context = await this.requireActiveCircleContext()
  this.requireOwner(context, 'Only the Circle owner can manage relationships')
  const relation = validateTreeRelation(input, safePeople(context.tree), safeRelations(context.tree))
  return this.circle.addTreeRelation({
    serverUserId: context.serverUserId,
    circleId: context.group.id,
    ...relation,
  })
}
```

Use the authoritative internal tree from `requireActiveCircleContext`; never accept `circleId` or identity from renderer input.

For `saveTreePosition`, require the target to be an internal `kind: 'user'` person; derive the viewer person by matching `person.userId === context.serverUserId`.

- [ ] **Step 4: Run focused main tests**

```bash
npx vitest run src/main/circle/familyTreeRules.test.ts src/main/circle/CircleService.test.ts src/main/circle/LegacyCircleManagementAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/main/circle/CircleService.ts src/main/circle/CircleService.test.ts src/shared/desktopApi.ts
git commit -m "feat: secure Family Tree mutations"
```

---

### Task 4: Expose a narrow Family Tree IPC/preload/renderer client surface

**Files:**
- Modify: `src/shared/desktopApi.ts`
- Modify: `src/main/circle/circleIpc.ts`
- Modify: `src/main/circle/circleIpc.test.ts`
- Modify: `src/preload/createDesktopApi.ts`
- Modify: `src/preload/createDesktopApi.test.ts`
- Modify: `src/renderer/services/circle/CircleClient.ts`
- Modify: `src/renderer/services/circle/DesktopCircleClient.ts`
- Modify: `src/renderer/services/circle/DesktopCircleClient.test.ts`
- Modify: `src/renderer/services/circle/MockCircleClient.ts`
- Modify: `src/renderer/services/circle/MockCircleClient.test.ts`

**Interfaces:**
- New IPC channels:
  - `circle:add-tree-relation`
  - `circle:delete-tree-relation`
  - `circle:save-tree-position`
- Public desktop Circle surface methods:

```ts
addTreeRelation(input: AddTreeRelationInput): Promise<{ success: true }>
deleteTreeRelation(input: { relationId: string }): Promise<{ success: true }>
saveTreePosition(input: SaveTreePositionInput): Promise<{ success: true }>
```

- Renderer `CircleClient` exposes equivalent methods, with `deleteTreeRelation(relationId: string)` allowed as a convenience wrapper if `DesktopCircleClient` reconstructs `{ relationId }` itself.

- [ ] **Step 1: Add failing IPC tests proving exact channels and identity stripping**

For add relation, invoke the registered handler with malicious extra keys:

```ts
await handler({
  kind: 'mother',
  aPersonId: 'user:1',
  bPersonId: 'user:2',
  serverUserId: 'attacker',
  circleId: 'foreign',
  ownerId: 'attacker',
})

expect(service.addTreeRelation).toHaveBeenCalledWith({
  kind: 'mother', aPersonId: 'user:1', bPersonId: 'user:2',
})
```

Do the same for position input and prove only `personId`, `x`, `y` survive.

- [ ] **Step 2: Run IPC/preload/client tests and verify RED**

```bash
npx vitest run src/main/circle/circleIpc.test.ts src/preload/createDesktopApi.test.ts src/renderer/services/circle/DesktopCircleClient.test.ts
```

Expected: FAIL because the channels/surface are absent.

- [ ] **Step 3: Implement handlers and public bridge methods**

`circleIpc.ts` must reconstruct payloads field-by-field rather than forwarding arbitrary objects:

```ts
register('circle:add-tree-relation', (_event, raw) => service.addTreeRelation({
  kind: raw?.kind,
  aPersonId: String(raw?.aPersonId ?? ''),
  bPersonId: String(raw?.bPersonId ?? ''),
}))
```

Keep main service validation authoritative; preload/client may sanitize shape but do not duplicate permission logic.

- [ ] **Step 4: Update approved-surface assertion**

The expected Circle method list must include exactly the three new Family Tree methods and no identity/transport helpers.

- [ ] **Step 5: Update `CircleClient`/`DesktopCircleClient` and mock client**

Example renderer client calls:

```ts
async addTreeRelation(input: AddTreeRelationInput) {
  await window.familyCircle.circle.addTreeRelation(input)
}

async deleteTreeRelation(relationId: string) {
  await window.familyCircle.circle.deleteTreeRelation({ relationId })
}

async saveTreePosition(input: SaveTreePositionInput) {
  await window.familyCircle.circle.saveTreePosition(input)
}
```

- [ ] **Step 6: Run bridge/client tests**

```bash
npx vitest run src/main/circle/circleIpc.test.ts src/preload/createDesktopApi.test.ts src/renderer/services/circle/DesktopCircleClient.test.ts src/renderer/services/circle/MockCircleClient.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/shared/desktopApi.ts src/main/circle/circleIpc.ts src/main/circle/circleIpc.test.ts src/preload/createDesktopApi.ts src/preload/createDesktopApi.test.ts src/renderer/services/circle/CircleClient.ts src/renderer/services/circle/DesktopCircleClient.ts src/renderer/services/circle/DesktopCircleClient.test.ts src/renderer/services/circle/MockCircleClient.ts src/renderer/services/circle/MockCircleClient.test.ts
git commit -m "feat: expose safe Family Tree desktop API"
```

---

### Task 5: Build plain-language relationship labels and the pure layout engine

**Files:**
- Create: `src/renderer/features/family-tree/familyTreeLabels.ts`
- Create: `src/renderer/features/family-tree/familyTreeLabels.test.ts`
- Create: `src/renderer/features/family-tree/familyTreeLayout.ts`
- Create: `src/renderer/features/family-tree/familyTreeLayout.test.ts`

**Interfaces:**

```ts
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

export type FamilyTreeLayoutNode = FamilyGraphNode & { x: number; y: number; generation: number; persisted: boolean }
export type FamilyTreeLayout = { nodes: FamilyTreeLayoutNode[]; edges: FamilyGraphEdge[] }
export type FamilyTreePath = { relationId: string; d: string; kind: string }

export function normalizeFamilyGraph(tree: CircleTreeRecord): FamilyGraph
export function assignFamilyGenerations(graph: FamilyGraph): Map<string, number>
export function layoutFamilyTree(graph: FamilyGraph, positions: CircleTreePositionRecord[]): FamilyTreeLayout
export function buildRelationshipPaths(layout: FamilyTreeLayout): FamilyTreePath[]

export function relationshipSentence(relation: CircleTreeRelationRecord, people: CircleTreePersonRecord[]): string
export function relationshipsForPerson(personId: string, relations: CircleTreeRelationRecord[], people: CircleTreePersonRecord[]): string[]
```

- [ ] **Step 1: Write failing label tests**

Examples:

```ts
expect(relationshipSentence(motherRelation, people)).toBe('Sarah is the mother of Trevor')
expect(relationshipsForPerson('user:trevor', [motherRelation], people)).toContain('Child of Sarah')
expect(relationshipsForPerson('user:sarah', [siblingRelation], people)).toContain('Sibling of Ruth')
```

Unknown legacy kinds must degrade safely to a neutral readable string rather than throw.

- [ ] **Step 2: Write failing layout tests**

Required cases:

```ts
it('filters invites but preserves legacy placeholders', ...)
it('places parent-like sources one generation above their targets', ...)
it('keeps siblings on the same generation when inferable', ...)
it('keeps spouse nodes on the same generation and near each other', ...)
it('lays out disconnected nodes instead of dropping them', ...)
it('uses valid persisted positions as overrides', ...)
it('ignores invalid persisted positions outside TREE_COORDINATE_LIMIT', ...)
it('returns identical coordinates for identical input', ...)
it('terminates on cyclic malformed historical data', ...)
```

- [ ] **Step 3: Run both files and verify RED**

```bash
npx vitest run src/renderer/features/family-tree/familyTreeLabels.test.ts src/renderer/features/family-tree/familyTreeLayout.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement labels and normalization/generation/layout/path functions**

Use deterministic constants such as:

```ts
const NODE_WIDTH = 180
const NODE_HEIGHT = 84
const H_GAP = 72
const V_GAP = 150
```

Generation assignment must use visited/work queues, never recursive traversal without a visited set. For contradictory constraints, keep the first stable generation assignment and ensure every visible node receives a coordinate.

Persisted positions override auto layout only when finite and inside bounds.

- [ ] **Step 5: Run pure renderer tests**

```bash
npx vitest run src/renderer/features/family-tree/familyTreeLabels.test.ts src/renderer/features/family-tree/familyTreeLayout.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/renderer/features/family-tree/familyTreeLabels.ts src/renderer/features/family-tree/familyTreeLabels.test.ts src/renderer/features/family-tree/familyTreeLayout.ts src/renderer/features/family-tree/familyTreeLayout.test.ts
git commit -m "feat: add Family Tree layout engine"
```

---

### Task 6: Build the accessible SVG Family Tree canvas

**Files:**
- Create: `src/renderer/features/family-tree/FamilyTreeCanvas.tsx`
- Create: `src/renderer/features/family-tree/FamilyTreeCanvas.test.tsx`
- Create: `src/renderer/features/family-tree/FamilyTree.css`

**Interfaces:**

```ts
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
```

- [ ] **Step 1: Write failing canvas tests**

Required behaviors:

```ts
it('renders user and read-only placeholder nodes but no invite nodes', ...)
it('marks viewer node with visible You text', ...)
it('selects a person node on click', ...)
it('selects a relationship path via its accessible control/overlay', ...)
it('zoom buttons adjust the view transform', ...)
it('fit restores a bounded transform containing all nodes', ...)
it('owner can drag a confirmed user node and persists only on pointer-up', ...)
it('ordinary member can drag only the viewer node', ...)
it('placeholder nodes are never draggable', ...)
it('rolls back local node position when onPositionChange rejects', ...)
it('provides a textual relationship summary in addition to SVG graphics', ...)
```

- [ ] **Step 2: Run canvas test and verify RED**

```bash
npx vitest run src/renderer/features/family-tree/FamilyTreeCanvas.test.tsx
```

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement SVG rendering, zoom/pan/fit, selection, and drag state**

Keep the component presentation-focused. It must not fetch Circle data or call `DesktopCircleClient` directly.

Drag behavior:

```ts
function handlePointerMove(...) {
  // update local visual coordinate only
}

async function handlePointerUp(...) {
  // call onPositionChange exactly once
  // on rejection restore dragStart position
}
```

Provide external keyboard-focusable buttons for zoom out, zoom in, and fit with `aria-label`s.

- [ ] **Step 4: Run canvas tests**

```bash
npx vitest run src/renderer/features/family-tree/FamilyTreeCanvas.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/renderer/features/family-tree/FamilyTreeCanvas.tsx src/renderer/features/family-tree/FamilyTreeCanvas.test.tsx src/renderer/features/family-tree/FamilyTree.css
git commit -m "feat: render interactive Family Tree canvas"
```

---

### Task 7: Replace the placeholder with a read-only Family Tree page first

**Files:**
- Create: `src/renderer/features/family-tree/FamilyTreePage.tsx`
- Create: `src/renderer/features/family-tree/FamilyTreePage.test.tsx`
- Modify: `src/renderer/app/App.tsx`
- Modify: app route test if present; otherwise add the route assertion to `FamilyTreePage.test.tsx` through the existing app test harness.

**Interfaces:**
- `FamilyTreePage` accepts optional dependency injection for tests following existing renderer feature patterns; production defaults to `DesktopCircleClient`.
- Consumes `CircleClient.getHomeSnapshot()` only if it contains all tree data needed; otherwise add a dedicated renderer-facing `getOverview()` method to `CircleClient`/`DesktopCircleClient` rather than reconstructing tree state from Home transformations. Prefer preserving the full safe `CircleOverview` for Family Tree.

- [ ] **Step 1: Write failing page tests for read-only states**

Cover:

```ts
it('shows Go to My Circles when overview has no Circle', ...)
it('renders active Circle name, member count, and invitation count', ...)
it('renders tree canvas for ready data', ...)
it('shows owner and non-owner no-relationship copy correctly', ...)
it('switches Circle through selectCircle then reloads authoritative overview', ...)
it('shows safe sync error and retries', ...)
it('shows selected person inspector with derived relationships', ...)
it('shows legacy placeholder as Family record with no mutation controls', ...)
```

- [ ] **Step 2: Run page test and verify RED**

```bash
npx vitest run src/renderer/features/family-tree/FamilyTreePage.test.tsx
```

Expected: FAIL because page/route do not exist.

- [ ] **Step 3: Implement loading, overview fetch, Circle selector, canvas, person/relation inspector, and safe states**

Do not add relationship mutation controls yet except inert/absent placeholders needed by tests. The first GREEN page should be useful read-only software.

- [ ] **Step 4: Replace `/family-tree` placeholder route**

In `App.tsx` remove:

```ts
{ path: '/family-tree', title: 'Family Tree' }
```

from `placeholderRoutes`, import `FamilyTreePage`, and add:

```tsx
<Route path="/family-tree" element={<FamilyTreePage />} />
```

- [ ] **Step 5: Run page/app tests**

```bash
npx vitest run src/renderer/features/family-tree/FamilyTreePage.test.tsx src/renderer/app
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/renderer/features/family-tree/FamilyTreePage.tsx src/renderer/features/family-tree/FamilyTreePage.test.tsx src/renderer/app/App.tsx src/renderer/services/circle/CircleClient.ts src/renderer/services/circle/DesktopCircleClient.ts src/renderer/services/circle/DesktopCircleClient.test.ts
git commit -m "feat: add read-only Family Tree page"
```

---

### Task 8: Add owner-only relationship creation with authoritative refetch

**Files:**
- Modify: `src/renderer/features/family-tree/FamilyTreePage.tsx`
- Modify: `src/renderer/features/family-tree/FamilyTreePage.test.tsx`
- Modify: `src/renderer/features/family-tree/FamilyTree.css`

**Interfaces:**
- Uses `viewerIsOwner` only; never role-string parsing.
- Calls `CircleClient.addTreeRelation(input)` then refetches the overview.
- Selectors include only confirmed `kind: 'user'` people.

- [ ] **Step 1: Write failing creation tests**

```ts
it('hides Add relationship from non-owner', ...)
it('shows sentence-like add form for owner', ...)
it('excludes placeholder and invite nodes from selectors', ...)
it('prevents same person in both selectors', ...)
it('submits exact semantic direction, e.g. Sarah mother of Trevor', ...)
it('refetches authoritative overview after successful creation', ...)
it('shows safe error and preserves form on failed creation', ...)
```

- [ ] **Step 2: Run page tests and verify RED**

```bash
npx vitest run src/renderer/features/family-tree/FamilyTreePage.test.tsx
```

- [ ] **Step 3: Implement owner form**

Form labels/options should present human-readable text while sending strict kinds:

```ts
const RELATION_OPTIONS = [
  ['mother', 'Mother of'],
  ['father', 'Father of'],
  ['guardian', 'Guardian of'],
  ['grandparent', 'Grandparent of'],
  ['spouse', 'Spouse / partner of'],
  ['sibling', 'Sibling of'],
  ['aunt_uncle', 'Aunt / uncle of'],
  ['cousin', 'Cousin of'],
] as const
```

- [ ] **Step 4: Run page tests**

```bash
npx vitest run src/renderer/features/family-tree/FamilyTreePage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 8**

```bash
git add src/renderer/features/family-tree/FamilyTreePage.tsx src/renderer/features/family-tree/FamilyTreePage.test.tsx src/renderer/features/family-tree/FamilyTree.css
git commit -m "feat: add Family Tree relationships"
```

---

### Task 9: Add owner-only relationship deletion and safe relation inspector

**Files:**
- Modify: `src/renderer/features/family-tree/FamilyTreePage.tsx`
- Modify: `src/renderer/features/family-tree/FamilyTreePage.test.tsx`
- Modify: `src/renderer/features/family-tree/FamilyTree.css`

**Interfaces:**
- Calls `CircleClient.deleteTreeRelation(relationId)` then refetches.
- Delete control appears only when `viewerIsOwner === true` and both relation endpoints are confirmed user nodes.

- [ ] **Step 1: Write failing deletion tests**

```ts
it('shows a plain-language relationship inspector after selecting an edge', ...)
it('hides delete for non-owner', ...)
it('keeps legacy placeholder-involving relationships read-only', ...)
it('requires confirmation before delete', ...)
it('deletes relation without removing either person', ...)
it('refetches after delete', ...)
it('shows safe error when stale relation deletion fails', ...)
```

- [ ] **Step 2: Run page tests and verify RED**

```bash
npx vitest run src/renderer/features/family-tree/FamilyTreePage.test.tsx
```

- [ ] **Step 3: Implement relation inspector and existing application confirmation-dialog pattern**

Confirmation copy must name the relation and make clear people remain in the Circle.

- [ ] **Step 4: Run page tests**

```bash
npx vitest run src/renderer/features/family-tree/FamilyTreePage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 9**

```bash
git add src/renderer/features/family-tree/FamilyTreePage.tsx src/renderer/features/family-tree/FamilyTreePage.test.tsx src/renderer/features/family-tree/FamilyTree.css
git commit -m "feat: remove Family Tree relationships safely"
```

---

### Task 10: Wire persisted node positioning through the page and authoritative server

**Files:**
- Modify: `src/renderer/features/family-tree/FamilyTreePage.tsx`
- Modify: `src/renderer/features/family-tree/FamilyTreePage.test.tsx`
- Modify: `src/renderer/features/family-tree/FamilyTreeCanvas.test.tsx` if integration reveals missing drag callback coverage.

**Interfaces:**
- Canvas calls page callback once on drag end.
- Page calls `CircleClient.saveTreePosition(input)`.
- On success, the page may keep the local coordinate immediately but must refresh/reconcile on the next normal overview fetch.
- On failure, canvas restores its previous effective coordinate and page shows a safe retryable message.

- [ ] **Step 1: Write failing integration tests**

```ts
it('persists one position write after a completed owner drag', ...)
it('ordinary member can persist only viewer node movement', ...)
it('never offers drag persistence for placeholder nodes', ...)
it('shows safe error and visually rolls back when save fails', ...)
```

- [ ] **Step 2: Run Family Tree page/canvas tests and verify RED**

```bash
npx vitest run src/renderer/features/family-tree/FamilyTreePage.test.tsx src/renderer/features/family-tree/FamilyTreeCanvas.test.tsx
```

- [ ] **Step 3: Wire `onPositionChange` to `CircleClient.saveTreePosition`**

Do not introduce throttled continuous writes. The only network/main write is drag completion.

- [ ] **Step 4: Run Family Tree renderer tests**

```bash
npx vitest run src/renderer/features/family-tree
```

Expected: PASS.

- [ ] **Step 5: Commit Task 10**

```bash
git add src/renderer/features/family-tree/FamilyTreePage.tsx src/renderer/features/family-tree/FamilyTreePage.test.tsx src/renderer/features/family-tree/FamilyTreeCanvas.test.tsx
git commit -m "feat: persist Family Tree node positions"
```

---

### Task 11: Add focused Family Tree security regression coverage

**Files:**
- Create: `src/main/circle/FamilyTreeSecurity.test.ts`
- Modify: `scripts/verify-boundaries.mjs` only if a new Family Tree-specific renderer boundary needs explicit enforcement; do not broaden unrelated rules.

**Interfaces:**
- Security suite exercises production service/IPC boundaries with fakes and proves foreign IDs/identity injection cannot become transport writes.

- [ ] **Step 1: Write the security regression suite**

Required tests:

1. renderer cannot choose `serverUserId` for add relation;
2. renderer cannot choose `circleId` for add/delete/position writes;
3. foreign-Circle person ID is rejected before adapter call;
4. placeholder relation creation is rejected before adapter call;
5. non-owner relationship write is rejected before adapter call;
6. ordinary member cannot move another user's node;
7. owner can move a confirmed member node;
8. stale foreign relation ID is rejected before adapter call;
9. ancestry cycle is rejected before adapter call;
10. no Family Tree mutation adds local SQLite tables or writes through Vault/database repositories.

Example adapter non-call assertion:

```ts
await expect(service.addTreeRelation({
  kind: 'sibling',
  aPersonId: 'user:mine',
  bPersonId: 'user:foreign',
})).rejects.toThrow()
expect(port.addTreeRelation).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run security suite and verify RED if it exposes a missing invariant**

```bash
npx vitest run src/main/circle/FamilyTreeSecurity.test.ts
```

If every invariant is already satisfied, the new suite may be GREEN on first run because it is regression coverage over completed behavior; do not manufacture a production defect. Record that the suite is additive evidence.

- [ ] **Step 3: Fix only genuine discovered boundary gaps**

Use systematic-debugging before changing production code if a security test fails unexpectedly.

- [ ] **Step 4: Run focused security + boundary checks**

```bash
npx vitest run src/main/circle/FamilyTreeSecurity.test.ts src/main/circle/CircleService.test.ts src/main/circle/circleIpc.test.ts
node scripts/verify-boundaries.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 11**

```bash
git add src/main/circle/FamilyTreeSecurity.test.ts scripts/verify-boundaries.mjs
git commit -m "test: harden Family Tree security boundaries"
```

---

### Task 12: Accessibility, state polish, and full feature verification

**Files:**
- Modify: `src/renderer/features/family-tree/FamilyTreePage.tsx`
- Modify: `src/renderer/features/family-tree/FamilyTreePage.test.tsx`
- Modify: `src/renderer/features/family-tree/FamilyTreeCanvas.tsx`
- Modify: `src/renderer/features/family-tree/FamilyTreeCanvas.test.tsx`
- Modify: `src/renderer/features/family-tree/FamilyTree.css`
- Modify: `README.md` only if the current feature list documents placeholder/core routes and would become inaccurate.

**Interfaces:**
- No new domain interfaces; this task closes user-facing and verification requirements.

- [ ] **Step 1: Add/confirm failing accessibility and state tests**

Ensure tests explicitly cover:

```ts
expect(screen.getByRole('button', { name: /zoom in/i })).toBeEnabled()
expect(screen.getByRole('button', { name: /fit family tree/i })).toBeEnabled()
expect(screen.getByRole('button', { name: /add relationship/i })).toHaveAccessibleName()
expect(screen.getByText(/couldn't sync this family tree/i)).toBeInTheDocument()
expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled()
```

Also assert selection is represented by text/ARIA state, not color only, and an accessible textual relation list exists.

- [ ] **Step 2: Implement any missing focus/ARIA/state polish**

Use existing app dialog and design-system conventions; do not introduce a new modal framework.

- [ ] **Step 3: Run the complete Family Tree-focused suite**

```bash
npx vitest run \
  src/main/circle/familyTreeRules.test.ts \
  src/main/circle/CircleService.test.ts \
  src/main/circle/LegacyCircleManagementAdapter.test.ts \
  src/main/circle/circleIpc.test.ts \
  src/main/circle/FamilyTreeSecurity.test.ts \
  src/preload/createDesktopApi.test.ts \
  src/renderer/services/circle/DesktopCircleClient.test.ts \
  src/renderer/features/family-tree
```

Expected: PASS.

- [ ] **Step 4: Run the repository verification gate**

```bash
npm run check
npm audit --audit-level=high
```

Expected: all tests/typecheck/boundaries/builds pass and audit reports 0 high-or-greater vulnerabilities.

- [ ] **Step 5: Review branch diff against the approved spec**

Check explicitly:

```text
no Family Tree SQLite schema
no graph dependency
no renderer identity fields
no placeholder mutation controls
no invite nodes on canvas
owner-only relation CRUD
member own-node movement only
coordinate bounds enforced
relation cycle/duplicate checks enforced
authoritative refetch after relation mutation
```

- [ ] **Step 6: Commit final polish/docs**

```bash
git add src/renderer/features/family-tree README.md
git commit -m "feat: finish Family Tree experience"
```

Skip `README.md` from the commit if it required no change.

---

### Task 13: Exact-head CI, review, and merge readiness

**Files:**
- No planned production changes. Any change caused by review restarts exact-head verification.

**Interfaces:**
- Produces a merge candidate with evidence tied to one exact SHA.

- [ ] **Step 1: Open/update a PR from `feature/family-tree` to `main`**

PR body must summarize architecture, security invariants, deferred placeholder lifecycle, and current exact test counts.

- [ ] **Step 2: Run/observe CI on the exact head**

Require the normal desktop CI to complete successfully. Windows packaging is not required unless this feature touches packaging files; the existing workflow path filters should remain unchanged.

- [ ] **Step 3: Perform merge-blocking code review**

Review especially:

- `CircleService` authorization and active-Circle derivation;
- IPC input reconstruction;
- adapter endpoint/body mapping;
- cycle detection;
- foreign person/relation handling;
- placeholder/invite restrictions;
- layout termination on malformed graphs;
- drag write frequency;
- safe error rendering.

- [ ] **Step 4: If review finds a defect, use TDD/systematic-debugging and rerun exact-head CI**

Never merge based on an older green SHA after a fix.

- [ ] **Step 5: Record final evidence before merge**

Record exact:

```text
feature head SHA
CI run ID + job ID
test file count
test count
boundary verifier result
Electron build result
renderer build result
npm audit result
```

- [ ] **Step 6: Hand off to finishing-a-development-branch**

Only after exact-head evidence is green. Use `superpowers:finishing-a-development-branch` to present integration choices; do not merge implicitly.

---

## Plan Self-Review

### Spec coverage

- Shared source of truth: Tasks 2-4, 11.
- Strict relationship kinds/canonicalization/cycle rules: Tasks 1, 3, 11.
- Safe owner capability: Tasks 1, 3, 7-9.
- Renderer identity boundary: Tasks 3-4, 11.
- Pure deterministic layout + malformed data tolerance: Task 5.
- SVG rendering, zoom/pan/fit/selection: Task 6.
- Real `/family-tree` route and Circle switching: Task 7.
- Owner add/delete workflows with authoritative refetch: Tasks 8-9.
- Position permissions/bounds/end-drag persistence/rollback: Tasks 1, 3, 6, 10.
- Legacy placeholder read-only + invite exclusion: Tasks 5-9, 11.
- Accessibility and safe states: Tasks 6-7, 12.
- Security regression + exact-head verification: Tasks 11-13.
- Direct-relative CRUD, Stories/Memories, exports, profile media, live collaboration remain excluded.

### Placeholder scan

This plan contains no `TBD`, `TODO`, “implement later”, or undefined implementation placeholder. Deferred product capabilities are explicit non-goals from the approved spec, not missing implementation steps.

### Type consistency

- Mutation kinds use `FamilyRelationshipKind` throughout.
- Add mutation input is `AddTreeRelationInput` throughout shared/main/preload/renderer layers.
- Position input is `SaveTreePositionInput` throughout.
- Main port methods always receive derived `serverUserId` + `circleId`; renderer-facing methods never do.
- `viewerIsOwner` is public safe capability; owner ID remains internal.
- Layout exports match the approved spec exactly: `normalizeFamilyGraph`, `assignFamilyGenerations`, `layoutFamilyTree`, `buildRelationshipPaths`.
