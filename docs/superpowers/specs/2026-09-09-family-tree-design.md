# Family Tree Design

## Summary

Family Tree becomes the next core Family Circle product feature. It turns the existing shared Circle membership graph into a real family relationship experience inside the Electron app, replacing the current `/family-tree` placeholder with an interactive tree that is readable by all confirmed Circle members and editable by the Circle owner.

The feature must extend the rebuild's existing Circle architecture rather than introduce a second local source of truth. Circle membership, family relationships, and persisted tree positions remain shared Circle data behind the existing Circle service. The desktop SQLite database remains for local authentication/session state and private Vault data; no Family Tree SQLite tables are added.

The first production slice supports confirmed Circle members, relationship creation/deletion, deterministic layout, SVG rendering, person/relation selection, Circle switching, and persisted node positions. Pre-existing legacy placeholder relatives may be displayed read-only, but direct non-app family member creation/edit/delete is explicitly deferred until its complete lifecycle is designed.

## Goals

1. Replace the `/family-tree` placeholder with a useful shared family tree for the active Circle.
2. Reuse the existing `CircleService.getOverview()` tree data (`people`, `relations`, `positions`) as the read model.
3. Extend the Circle port/service/IPC/preload/client stack with safe tree mutation operations.
4. Enforce ownership, active-Circle membership, relationship validity, and ancestry-cycle rules in the Electron main process before any shared-server mutation.
5. Render the tree with pure TypeScript/React/SVG and no new graph-library dependency.
6. Persist deliberate manual node moves through the shared Circle service.
7. Keep renderer contracts identity-safe: the renderer must never supply `serverUserId`, Circle owner identity, local user identity, backend URLs, API keys, or transport details.
8. Preserve the current Circle membership and invitation workflows without changing invite semantics.

## Non-goals for this slice

The following are intentionally out of scope:

- Direct/non-app family member creation, editing, or deletion.
- Profile photos and remote avatar URLs.
- Birth/death dates, marriage/divorce dates, biological/adoptive metadata.
- GEDCOM import/export.
- PNG/PDF export.
- AI-generated family history or automatic relationship inference.
- Stories or Memories integration.
- Real-time collaborative editing/push updates.
- Undo/redo.
- Automatic relationship creation from invitation roles.
- New Family Tree SQLite persistence.

These exclusions are deliberate so the first Family Tree release is complete rather than broad but partially supported.

## Existing architecture to preserve

The rebuild already models Circle tree data publicly:

- `CircleTreePersonRecord`
- `CircleTreeRelationRecord`
- `CircleTreePositionRecord`
- `CircleTreeRecord`
- `CircleOverview`

`CircleService.getOverview()` already restores the protected session, resolves the user's shared Circle identity, resolves the active Circle, retrieves its tree, and returns a safe public representation. The existing Circle service also handles Circle selection, membership management, and owner-only invitation/member mutations.

The reference shared Circle server already supports:

- owner-only relationship creation,
- owner-only relationship deletion,
- persisted node positions,
- confirmed-user and placeholder person nodes,
- server-side group membership validation,
- server-side owner validation.

The new desktop feature extends this path rather than bypassing it.

## Source of truth

Family Tree is shared Circle data.

The authoritative flow is:

```text
FamilyTree renderer
    -> DesktopCircleClient
    -> window.familyCircle.circle
    -> preload invoke
    -> circle IPC
    -> CircleService
    -> CirclePort / LegacyCircle adapter
    -> shared Circle server
```

The desktop application does not mirror relationships into local SQLite and does not attempt offline conflict resolution in this slice.

After every relationship mutation, the UI refetches the authoritative tree rather than permanently trusting optimistic relationship state.

## Relationship model

### Strict mutation type

The shared public contract adds the exact type:

```ts
export type FamilyRelationshipKind =
  | 'mother'
  | 'father'
  | 'guardian'
  | 'grandparent'
  | 'spouse'
  | 'sibling'
  | 'aunt_uncle'
  | 'cousin'
```

`CircleTreeRelationRecord.kind` remains `string` on the read side so historical/legacy server relationship kinds can still be displayed safely. Mutation inputs use `FamilyRelationshipKind` and reject all other values.

The legacy server also understands `friend`. Existing `friend` relationships may be displayed safely, but the Family Tree creation UI does not offer `friend` because it is not genealogical structure.

### Directed relationships

These are directional:

- `mother`: A is mother of B.
- `father`: A is father of B.
- `guardian`: A is guardian of B.
- `grandparent`: A is grandparent of B.

`child` and `grandchild` are not stored as separate relationship kinds. They are display-time inverse labels derived from parent/grandparent relations.

### Undirected relationships

These are symmetric:

- `spouse`
- `sibling`
- `cousin`

Undirected relation endpoints must be canonicalized before duplicate checks so A-spouse-B and B-spouse-A are the same relationship.

`aunt_uncle` is represented directionally: A is aunt/uncle of B.

### Invitation role independence

Invitation roles such as `Parent`, `Child`, `Sibling`, or `Spouse / Partner` remain onboarding/membership metadata only. They must not automatically create Family Tree edges because the invitation does not identify the other person in the relationship.

## Relationship integrity rules

Before the adapter is called, `CircleService` must enforce:

1. A protected authenticated session exists.
2. The signed-in local user still has a valid shared `serverUserId`.
3. The active Circle still belongs to that shared user.
4. The viewer is the active Circle owner for relationship mutations.
5. Both relationship endpoints are confirmed `kind: 'user'` nodes in the authoritative active-Circle tree for this slice.
6. Both endpoint IDs are non-empty and distinct.
7. The relationship kind is in `FamilyRelationshipKind`.
8. Undirected relationships are canonicalized.
9. An identical relationship does not already exist.
10. A directed ancestry relation must not introduce an ancestry cycle.
11. Deleting a relationship requires the relation to exist in the active Circle's authoritative tree.

The renderer cannot bypass these checks by supplying a different Circle ID, owner ID, or server user ID because those values are derived in main.

## Ancestry cycle detection

New parent-like relationships must not create loops such as:

```text
John parent-of Mary
Mary parent-of Peter
Peter parent-of John
```

For cycle detection, ancestry edges include `mother`, `father`, `guardian`, and `grandparent`. Before adding A -> B, build a directed ancestry graph from the authoritative active-Circle tree and reject the mutation if B can already reach A.

The renderer/layout engine must still tolerate malformed historical server data without infinite recursion or crashes. Write validation prevents new cycles; read/layout behavior remains defensive.

## Circle port extensions

The internal `CirclePort` gains these exact methods:

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

The legacy adapter maps these to the existing shared Circle server endpoints. Transport details remain main-process implementation details and are not exposed through the desktop API.

## CircleService public mutation API

Renderer-facing service methods use these exact signatures and do not accept identity or Circle ownership inputs:

```ts
addTreeRelation(input: {
  kind: FamilyRelationshipKind
  aPersonId: string
  bPersonId: string
}): Promise<{ success: true }>

deleteTreeRelation(input: {
  relationId: string
}): Promise<{ success: true }>

saveTreePosition(input: {
  personId: string
  x: number
  y: number
}): Promise<{ success: true }>
```

Each method resolves the active Circle and authoritative tree from the protected session before validating and calling the port.

## Safe viewer capability

The renderer must not infer owner permissions from free-form Circle role text.

Extend `CircleOverview` with a safe derived capability:

```ts
viewerIsOwner: boolean
```

- Empty overview states return `viewerIsOwner: false`.
- Ready overview states set it from `tree.group.ownerId === serverUserId` inside `CircleService` before `ownerId` is stripped from the public tree.

The UI uses `viewerIsOwner` to show relationship mutation controls and move-any-node behavior. No owner ID crosses the public desktop contract.

## Position permissions and bounds

Manual node positioning follows the reference server's permission model:

- Circle owner may move any confirmed `kind: 'user'` member node.
- Ordinary Circle member may move only their own confirmed `kind: 'user'` node.
- Legacy placeholder nodes are read-only in v1 and cannot be dragged or repositioned through the desktop UI.

Main validates the requested person against the active tree and determines the viewer's own person node using the protected shared identity.

Define:

```ts
export const TREE_COORDINATE_LIMIT = 100_000
```

Both `x` and `y` must be finite numbers in the inclusive range `[-100000, 100000]`. Persist only on pointer-up/end-drag, never on every pointer move.

If a save fails, the renderer restores the prior effective position and shows a safe retryable message.

## Public desktop contract

Extend `window.familyCircle.circle` through the established layers:

- `src/shared/desktopApi.ts`
- `src/main/circle/circleIpc.ts`
- `src/preload/createDesktopApi.ts`
- `src/renderer/services/circle/DesktopCircleClient.ts`

The public contract includes only safe relationship/person IDs, `FamilyRelationshipKind`, finite coordinates, safe tree data, and `viewerIsOwner`. It must not expose:

- `serverUserId`
- `localUserId`
- owner IDs
- API keys
- server URLs
- transport headers
- raw backend errors

The approved-surface preload test must be updated so future accidental Circle API expansion is detected.

## Read model and pending invitations

Visible tree nodes in v1 are:

1. Confirmed Circle users (`kind: 'user'`) — fully selectable; relationship-capable; movable according to position permissions.
2. Pre-existing legacy placeholder relatives (`kind: 'placeholder'`) — visible and selectable read-only so historical family data is not silently hidden; not relationship-capable through v1 controls; not draggable.

Pending invitations (`kind: 'invite'`) do not render in the tree canvas and cannot participate in relationships. The Family Tree page may display a count such as `2 invitations pending` and direct the owner to Invitations.

No v1 UI creates, edits, deletes, relates, or repositions placeholder nodes. A complete direct-relative lifecycle is a separate follow-up slice.

## Layout engine

Create a pure TypeScript layout module with no React dependencies.

Use these exact exported functions:

```ts
normalizeFamilyGraph(tree: CircleTreeRecord): FamilyGraph
assignFamilyGenerations(graph: FamilyGraph): Map<string, number>
layoutFamilyTree(graph: FamilyGraph, positions: CircleTreePositionRecord[]): FamilyTreeLayout
buildRelationshipPaths(layout: FamilyTreeLayout): FamilyTreePath[]
```

Responsibilities:

- normalize visible user/placeholder nodes and relations,
- exclude invitation nodes,
- assign graph generations defensively,
- keep spouses/partners adjacent when practical,
- keep siblings on the same generation where inferable,
- distribute disconnected nodes instead of dropping them,
- apply persisted coordinates when present,
- provide deterministic coordinates for all remaining nodes,
- generate relationship path descriptors for SVG rendering,
- terminate safely when historical data contains cycles or contradictory edges.

Persisted coordinates apply only when finite and inside `TREE_COORDINATE_LIMIT`; invalid historical coordinates are ignored and replaced by automatic layout coordinates.

## Visual rendering

Use React + SVG; do not add D3, vis.js, React Flow, ELK, or another graph library in v1.

The SVG canvas supports:

- person cards/nodes,
- relationship lines,
- node selection,
- relationship selection,
- pan,
- zoom controls,
- wheel zoom,
- fit-to-tree,
- permitted user-node dragging,
- keyboard-accessible controls outside the SVG.

Use initials rather than fabricated profile photos. The viewer's node gets a clear `You` indicator. Legacy placeholder nodes get a subtle `Family record`/read-only treatment that is distinguishable without relying only on color.

The canvas owns rendering/interactions only. Layout stays in the pure layout module, and data loading/mutations stay in the page/integration component.

## Family Tree page

`/family-tree` becomes a real route and is removed from `placeholderRoutes`.

Page structure:

```text
Family Tree                         Circle selector
See how your family connects.      N members · M invitations pending

[ zoom out ] [ zoom in ] [ fit ]                [ Add relationship ] owner only

+-----------------------------------------------------------+
|                                                           |
|                 interactive SVG family tree               |
|                                                           |
+------------------------------------------+----------------+
                                           | inspector       |
                                           | selected person |
                                           | or relation     |
                                           +-----------------+
```

The Circle selector uses the existing `CircleOverview.circles` data. Selecting another Circle calls existing `selectCircle(circleId)` and then refetches overview/tree state.

## Person inspector

Selecting a confirmed person shows safe available data:

- name,
- Circle role,
- `You` marker where applicable,
- derived relationships such as `Mother of X`, `Sibling of Y`, or `Child of Z`.

Selecting a legacy placeholder shows its safe existing name/role/email fields where present and a read-only `Family record` indicator. The inspector offers no placeholder mutation controls.

Do not add profile editing to this feature.

## Relationship creation UI

Only `viewerIsOwner === true` shows `Add relationship`.

The form is sentence-like instead of exposing implementation terminology:

```text
Sarah Kasule
is the
Mother of
Trevor Kasule
```

The two people must be different confirmed `kind: 'user'` Circle members. Placeholder and invitation nodes are excluded from the selectors.

After success:

1. close/reset the mutation form,
2. refetch `CircleOverview`,
3. rebuild layout from authoritative data,
4. retain the current pan/zoom where practical.

Do not leave optimistic relationship state permanently if the refetch disagrees.

## Relationship deletion UI

Selecting a relationship shows a plain-language description. Only `viewerIsOwner === true` sees `Remove relationship`.

For v1, deletion controls appear only when both endpoints are confirmed `kind: 'user'` nodes. Relationships involving legacy placeholder nodes remain read-only so v1 does not partially manage placeholder lifecycle data.

Deletion requires confirmation. Removing a relationship must never remove either person or Circle membership.

After success, refetch the authoritative tree.

## Empty/loading/error states

### No Circle

Show:

```text
Your family tree starts with a Circle.
Create or join a Circle first.
[ Go to My Circles ]
```

### Circle with confirmed members but no mutable relationships

Owner:

```text
Your family members are here.
Connect them to build your tree.
[ Add first relationship ]
```

Non-owner:

```text
Relationships haven't been added yet.
The Circle owner can build this family tree.
```

### Loading

Render a stable page skeleton/spinner without stale prior-Circle relationship controls.

### Sync failure

Show a safe message such as:

```text
We couldn't sync this Family Tree.
[ Try again ]
```

Do not expose HTTP status text, raw adapter exceptions, API endpoints, or backend stack traces.

## Accessibility

- Zoom/fit/add/delete controls are keyboard-focusable buttons with labels.
- Relationship forms use associated labels and clear error text.
- Selected node/relation state is conveyed beyond color alone.
- Tree content has a textual accessible summary/list available to assistive technologies; the SVG is not the only representation of relationships.
- Confirmation dialogs follow the existing application dialog/focus patterns.
- Pointer dragging is an enhancement; all core relationship CRUD remains possible without drag input.

## Notifications and real-time behavior

The reference server already generates `tree_changed` notifications for shared tree mutations. This v1 feature does not add live push/subscriptions.

After the current viewer mutates the tree, the page refetches immediately. Changes made by another desktop become visible on next page reload, Circle switch, explicit retry/refresh, or future sync mechanism.

Real-time collaborative editing is intentionally deferred.

## Security invariants

1. Renderer never chooses the acting user identity.
2. Renderer never chooses the authoritative Circle for a mutation; main uses the active Circle from protected local session state.
3. Tree mutation endpoints are reachable only through the approved Circle IPC surface.
4. Main checks Circle membership and owner permissions even though the shared server also checks them.
5. A person from another Circle cannot be used as a mutation endpoint.
6. A stale/deleted relationship cannot be deleted by arbitrary ID without authoritative-tree validation.
7. Raw backend identity fields remain stripped from the renderer tree contract.
8. Renderer permission decisions use safe `viewerIsOwner`, never role-string parsing or raw owner identity.
9. Relationship mutation failures expose safe user-facing errors only.
10. Placeholder/invitation IDs cannot be used in v1 relationship mutation or position endpoints.

## Testing strategy

### Pure relationship-rule tests

Cover:

- allowed and rejected mutation kinds,
- directed endpoint semantics,
- undirected canonicalization,
- self-relation rejection,
- duplicate rejection,
- ancestry-cycle rejection,
- malformed historical graph tolerance.

### Main Circle service tests

Cover:

- protected-session requirement,
- no shared user link,
- no active Circle,
- `viewerIsOwner` derivation without owner-ID exposure,
- non-owner mutation rejection,
- another-Circle person rejection,
- placeholder/invite mutation rejection,
- stale relation deletion rejection,
- owner add/delete success,
- own-node position permission for ordinary members,
- other-node position rejection for ordinary members,
- owner move-any-confirmed-node success,
- placeholder position rejection,
- non-finite coordinate rejection,
- out-of-range coordinate rejection.

### Adapter tests

Cover exact existing server path/body mapping without exposing transport to renderer.

### IPC/preload/client tests

Cover:

- exact channels,
- safe input reconstruction,
- approved public surface,
- no identity injection fields,
- strict `FamilyRelationshipKind` mutation input,
- DesktopCircleClient as the only renderer access path for the Circle bridge.

### Layout tests

Cover:

- invitation exclusion,
- legacy placeholder read-only inclusion,
- parent generations,
- grandparent generations,
- spouse adjacency,
- siblings,
- disconnected nodes,
- persisted-position override,
- invalid persisted-position fallback,
- deterministic layout,
- cyclic/malformed read data termination.

### Renderer tests

Cover:

- no-Circle state,
- no-relationship owner/non-owner states,
- loading/error/retry,
- Circle switching,
- node/relation selection,
- legacy placeholder read-only rendering,
- invitation exclusion/count,
- owner-only add/delete controls using `viewerIsOwner`,
- successful mutation/refetch,
- mutation error display,
- drag persistence on pointer-up only,
- failed position save rollback,
- accessibility labels/keyboard controls.

### Security regression test

Add a focused Family Tree security suite proving the renderer cannot mutate another Circle by supplying foreign person/relation IDs, cannot use placeholder/invite IDs for v1 mutation, and cannot supply identity-like fields to influence the actor or Circle.

## Verification gates

Implementation follows TDD with RED -> GREEN evidence for each independently reviewable task.

Before merge, the exact feature head must pass:

```text
npm ci
npm run check
npm audit --audit-level=high
```

The final review must record the exact head SHA, CI run IDs, test-file count, test count, architecture-boundary result, build result, and audit result. No completion claim is made from an earlier head after any subsequent change.

## Delivery sequence

The implementation plan must decompose the feature in this order:

1. Relationship types and pure integrity rule engine.
2. CirclePort mutation interfaces and legacy adapter mappings.
3. CircleService active-Circle/owner/integrity enforcement and `viewerIsOwner` capability.
4. IPC, preload contract, and DesktopCircleClient mutations.
5. Pure layout engine.
6. SVG FamilyTreeCanvas.
7. Read-only FamilyTree page and Circle switching.
8. Owner relationship creation workflow.
9. Owner relationship deletion workflow.
10. Persisted node dragging/position permissions.
11. Empty/error/accessibility polish.
12. Family Tree security regression suite.
13. Exact-head full verification and merge-blocking review.

A meaningful intermediate checkpoint exists after the read-only page: the active Circle's existing authoritative tree can be viewed before any relationship mutation controls are enabled.

## Follow-up slice: direct family members

A later Family Tree design may introduce relatives without Family Circle accounts. That slice must define a complete lifecycle before creation is exposed:

- create direct member,
- edit/rename direct member,
- remove direct member,
- relationship cleanup behavior,
- optional future account-linking semantics,
- permissions and notifications.

The first Family Tree merge must not expose create-placeholder UI without that full lifecycle.