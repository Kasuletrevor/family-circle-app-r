# Circle Members and Invitations Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Members and Invitations placeholders into authoritative active-Circle management views with safe resend, cancel, remove-member, and leave-Circle actions.

**Architecture:** Extend the existing `CircleService` trust boundary rather than adding a second management subsystem. React works only with safe `personId` handles and active-Circle business operations; Electron main restores the protected session, resolves internal member/invitation identities from authoritative tree data, authorizes the action, and delegates Jose-compatible requests through `LegacyCircleAuthAdapter`.

**Tech Stack:** Electron 44, React 19, TypeScript 7, Vite 8, Vitest 4, existing SQLite/session infrastructure, Jose-compatible Circle HTTP API.

**Spec:** `docs/superpowers/specs/2026-09-04-circle-members-invitations-design.md`

## Global Constraints

- The active Circle remains the single viewer/management selection state; do not add a second selected-management Circle store.
- Renderer must never receive or choose `serverUserId`, `fromUserId`, trusted target user IDs, invitation IDs, invitation tokens, temporary passwords, compatibility URLs, or API keys.
- `personId` is a safe lookup handle only; main must re-fetch authoritative state before each management mutation.
- Resend, cancel, and remove-member are owner-only.
- Circle owner cannot be removed and cannot leave their own Circle.
- Leave Circle is available only to non-owner current members.
- No optimistic destructive UI updates; refresh authoritative details after confirmed mutations.
- Preserve Jose's current endpoints and behavior through `LegacyCircleAuthAdapter`.
- Rename, delete, ownership transfer, relationship/tree editing, and `/v2` migration remain out of scope.

## File Structure

**Shared/public contracts**
- Modify `src/shared/desktopApi.ts` — safe management DTOs and desktop capabilities only.

**Main-process internal models and compatibility**
- Modify `src/main/circle/circleModels.ts` — internal invitation/member resolution data only.
- Modify `src/main/circle/LegacyCircleAuthAdapter.ts` — Jose-compatible cancel/remove/leave calls; resend reuses invite behavior.
- Modify `src/main/circle/LegacyCircleAuthAdapter.test.ts`.
- Modify `src/main/circle/CircleService.ts` — active-Circle details read, authorization, safe-person resolution, mutations, leave fallback.
- Modify `src/main/circle/CircleService.test.ts`.
- Modify `src/main/circle/circleIpc.ts` and `src/main/circle/circleIpc.test.ts`.

**Preload**
- Modify `src/preload/createDesktopApi.ts` and `src/preload/createDesktopApi.test.ts`.

**Renderer service layer**
- Modify `src/renderer/services/circle/types.ts`.
- Modify `src/renderer/services/circle/CircleClient.ts`.
- Modify `src/renderer/services/circle/DesktopCircleClient.ts` and `.test.ts`.
- Modify `src/renderer/services/circle/MockCircleClient.ts` and `.test.ts`.

**Renderer UI**
- Create `src/renderer/features/circles/CircleManagement.tsx`.
- Create `src/renderer/features/circles/CircleManagement.css`.
- Create `src/renderer/features/circles/CircleManagement.test.tsx`.
- Create `src/renderer/features/circles/ConfirmCircleActionDialog.tsx`.
- Create `src/renderer/features/circles/ConfirmCircleActionDialog.test.tsx`.
- Modify `src/renderer/features/circles/MyCircles.tsx` and `.test.tsx`.
- Modify `src/renderer/app/App.tsx` and `App.test.tsx`.

**Hardening/docs**
- Modify `scripts/verify-boundaries.mjs`.
- Modify `README.md`.

---

### Task 1: Safe Circle-details contracts and internal resolution models

**Files:**
- Modify: `src/shared/desktopApi.ts`
- Modify: `src/main/circle/circleModels.ts`
- Test: `src/main/circle/CircleService.test.ts`
- Test: `src/preload/createDesktopApi.test.ts`

**Interfaces:**
- Produces public types:

```ts
export interface CircleDetailsMember {
  personId: string
  name: string
  email: string | null
  role: string
  isViewer: boolean
  isOwner: boolean
}

export interface CircleDetailsInvitation {
  personId: string
  email: string
  role: string
  status: 'pending'
}

export interface CircleDetails {
  circle: {
    id: string
    name: string
    role: string
    memberCount: number
    pendingInvitationCount: number
  }
  members: CircleDetailsMember[]
  invitations: CircleDetailsInvitation[]
}

export interface ResendInvitationResult {
  outcome: 'sent' | 'delivery-failed'
}
```

- Produces `DesktopApi.circle` signatures:

```ts
getCircleDetails(): Promise<CircleDetails | null>
resendInvitation(input: { personId: string }): Promise<ResendInvitationResult>
cancelInvitation(input: { personId: string }): Promise<{ success: true }>
removeMember(input: { personId: string }): Promise<{ success: true }>
leaveCircle(): Promise<{ success: true }>
```

- Extends internal `CircleTreePersonInternal` only as needed to preserve authoritative pending-invitation identity in main. A recommended explicit field is:

```ts
invitationId: string | null
```

This field must never appear in the public DTO.

- [ ] **Step 1: Write failing contract tests**

Add assertions proving a public `CircleDetails` shape can be built without internal IDs and that the desktop API type includes the five new methods. Add a compile-time fixture in existing tests that intentionally omits `serverUserId`, `userId`, `ownerId`, `invitationId`, `token`, and `tempPassword`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- src/main/circle/CircleService.test.ts src/preload/createDesktopApi.test.ts
```

Expected: FAIL because the new contract/types/capabilities do not exist.

- [ ] **Step 3: Add minimal public/internal types**

Implement the interfaces above in `src/shared/desktopApi.ts`. Add only the internal identity field(s) needed in `circleModels.ts`; keep public records free of those fields.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
npm test -- src/main/circle/CircleService.test.ts src/preload/createDesktopApi.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/desktopApi.ts src/main/circle/circleModels.ts src/main/circle/CircleService.test.ts src/preload/createDesktopApi.test.ts
git commit -m "feat: define safe Circle management contracts"
```

---

### Task 2: Legacy adapter management operations

**Files:**
- Modify: `src/main/circle/LegacyCircleAuthAdapter.ts`
- Modify: `src/main/circle/LegacyCircleAuthAdapter.test.ts`

**Interfaces:**
- Produces:

```ts
cancelInvitation(input: {
  serverUserId: string
  circleId: string
  invitationId: string
}): Promise<{ success: true }>

removeMember(input: {
  serverUserId: string
  circleId: string
  targetServerUserId: string
}): Promise<{ success: true }>

leaveCircle(input: {
  serverUserId: string
  circleId: string
}): Promise<{ success: true }>
```

- Existing `inviteMember(...)` remains the resend transport for an already-pending invite.
- `getTree()` must normalize the authoritative pending invitation ID into internal `invitationId` if Jose returns `invitationId`, `invitation_id`, or a dedicated raw invite record ID.

- [ ] **Step 1: Write failing adapter tests**

Test exact requests:

```text
POST /api/group/{groupId}/invitation/cancel
body: { fromUserId, invitationId }

POST /api/group/{groupId}/member/remove
body: { fromUserId, userId }

POST /api/group/{groupId}/leave
body: { fromUserId }
```

Also assert resend of a pending invite still uses `/api/group/invite-email`, reports `delivery-failed` when `emailSent === false`, and no token/temp password is returned.

- [ ] **Step 2: Run adapter test and verify RED**

```bash
npm test -- src/main/circle/LegacyCircleAuthAdapter.test.ts
```

Expected: FAIL because management methods are absent.

- [ ] **Step 3: Implement the three adapter methods**

Use existing `postJson()` and current API-key/timeout behavior. Normalize all inputs with `String(...).trim()`; do not add endpoint literals anywhere else.

- [ ] **Step 4: Extend `getTree()` internal invite normalization**

For `kind === 'invite'`, retain a main-only invitation ID when present. Do not infer one from email or expose it through `safeTree()`.

- [ ] **Step 5: Run adapter tests**

```bash
npm test -- src/main/circle/LegacyCircleAuthAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/circle/LegacyCircleAuthAdapter.ts src/main/circle/LegacyCircleAuthAdapter.test.ts src/main/circle/circleModels.ts
git commit -m "feat: add legacy Circle management operations"
```

---

### Task 3: CircleService details, authorization, identity resolution, and leave fallback

**Files:**
- Modify: `src/main/circle/CircleService.ts`
- Modify: `src/main/circle/CircleService.test.ts`

**Interfaces:**
- Extend `CirclePort` with Task 2 methods.
- Produces:

```ts
getCircleDetails(): Promise<CircleDetails | null>
resendInvitation(input: { personId: string }): Promise<ResendInvitationResult>
cancelInvitation(input: { personId: string }): Promise<{ success: true }>
removeMember(input: { personId: string }): Promise<{ success: true }>
leaveCircle(): Promise<{ success: true }>
```

- Add a private active-management helper with semantics equivalent to:

```ts
private async requireActiveCircleContext(): Promise<{
  record: UserRecord
  serverUserId: string
  group: CircleGroupInternal
  groups: CircleGroupInternal[]
  tree: CircleTreeInternal
}>
```

It must restore the protected session, require a persisted shared identity, list memberships, resolve the active Circle safely, and fetch the authoritative tree.

- [ ] **Step 1: Write RED tests for details read**

Cover:
- no shared identity -> `null` details and stale active preference cleared when appropriate;
- active member gets confirmed members + pending invites;
- `isViewer` derives from internal `userId === serverUserId`;
- `isOwner` derives from authoritative group owner ID;
- counts equal returned member/invite arrays;
- no internal identity fields appear in the returned object.

- [ ] **Step 2: Write RED tests for owner mutations**

Cover:
- non-owner resend/cancel/remove rejected;
- stale/unknown `personId` rejected;
- owner target cannot be removed;
- remove maps safe `personId` to internal target `userId` only after authoritative re-fetch;
- cancel maps safe invite `personId` to authoritative internal `invitationId`;
- resend maps safe invite `personId` to authoritative email/role and calls `inviteMember` using those values, not renderer values.

- [ ] **Step 3: Write RED tests for leave**

Cover:
- owner leave rejected;
- non-member/no-session rejected;
- non-owner leave calls adapter with session-derived identity;
- after leave, re-list memberships; persist another Circle as fallback if available, otherwise `setActiveCircleId(..., null)`.

- [ ] **Step 4: Run service tests and verify RED**

```bash
npm test -- src/main/circle/CircleService.test.ts
```

Expected: FAIL only for absent management behavior.

- [ ] **Step 5: Implement `getCircleDetails()`**

Map confirmed `kind === 'user'` people to `members`, pending `kind === 'invite'` people to `invitations`, and use the authoritative group owner identity for owner status.

- [ ] **Step 6: Implement resend/cancel/remove**

Before every mutation, call the active-context helper again. Never accept email, role, internal user ID, or invitation ID from the renderer.

Use stable main errors:

```text
Only the Circle owner can manage invitations
Only the Circle owner can remove members
The Circle owner cannot be removed
That member is no longer in this Circle
That invitation is no longer pending
```

- [ ] **Step 7: Implement leave fallback**

After successful adapter leave, re-list groups using the same shared identity. Persist `groups[0].id` when any remain, otherwise persist `null`.

- [ ] **Step 8: Run service tests + typecheck**

```bash
npm test -- src/main/circle/CircleService.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main/circle/CircleService.ts src/main/circle/CircleService.test.ts
git commit -m "feat: add protected Circle management service"
```

---

### Task 4: IPC and preload management boundary

**Files:**
- Modify: `src/main/circle/circleIpc.ts`
- Modify: `src/main/circle/circleIpc.test.ts`
- Modify: `src/preload/createDesktopApi.ts`
- Modify: `src/preload/createDesktopApi.test.ts`
- Modify: `src/shared/desktopApi.ts`

**Interfaces:**
- Add channels:

```text
circle:get-details
circle:resend-invitation
circle:cancel-invitation
circle:remove-member
circle:leave
```

- Payloads:

```ts
{ personId: string } // resend/cancel/remove
undefined            // details/leave
```

- [ ] **Step 1: Write failing IPC sanitization test**

Invoke resend/cancel/remove with payloads containing valid `personId` plus malicious fields:

```ts
{
  personId: 'safe-person',
  fromUserId: 'attacker',
  serverUserId: 'attacker',
  userId: 'attacker',
  invitationId: 'secret',
  token: 'secret',
  tempPassword: 'secret'
}
```

Assert `CircleService` receives exactly `{ personId: 'safe-person' }`.

- [ ] **Step 2: Write failing preload test**

Assert exactly the five new capabilities invoke their expected channels/payloads.

- [ ] **Step 3: Run tests and verify RED**

```bash
npm test -- src/main/circle/circleIpc.test.ts src/preload/createDesktopApi.test.ts
```

Expected: FAIL because channels/capabilities are absent.

- [ ] **Step 4: Implement IPC handlers and preload methods**

Use `recordOf()` and reconstruct only approved payload fields. Do not forward raw payload objects.

- [ ] **Step 5: Run tests + typecheck**

```bash
npm test -- src/main/circle/circleIpc.test.ts src/preload/createDesktopApi.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/circle/circleIpc.ts src/main/circle/circleIpc.test.ts src/preload/createDesktopApi.ts src/preload/createDesktopApi.test.ts src/shared/desktopApi.ts
git commit -m "feat: expose safe Circle management IPC"
```

---

### Task 5: DesktopCircleClient management surface and cache invalidation

**Files:**
- Modify: `src/renderer/services/circle/types.ts`
- Modify: `src/renderer/services/circle/CircleClient.ts`
- Modify: `src/renderer/services/circle/DesktopCircleClient.ts`
- Modify: `src/renderer/services/circle/DesktopCircleClient.test.ts`
- Modify: `src/renderer/services/circle/MockCircleClient.ts`
- Modify: `src/renderer/services/circle/MockCircleClient.test.ts`

**Interfaces:**
- Renderer types:

```ts
export type CircleManagementMember = CircleDetailsMember
export type CircleManagementInvitation = CircleDetailsInvitation
export type CircleManagementSnapshot = CircleDetails
```

- Extend `CircleClient`:

```ts
getCircleDetails(): Promise<CircleManagementSnapshot | null>
resendInvitation(personId: string): Promise<ResendInvitationResult>
cancelInvitation(personId: string): Promise<void>
removeMember(personId: string): Promise<void>
leaveCircle(): Promise<void>
```

- Extend `CircleDesktopOperations` with matching preload calls.

- [ ] **Step 1: Write failing client tests**

Prove:
- details are returned authoritatively, not derived from Home tree;
- no fabricated invitations;
- each mutation delegates to preload with only `personId` or no payload;
- every mutation invalidates an already in-flight Home overview;
- a failed mutation also clears stale in-flight management read state before the next read.

- [ ] **Step 2: Run client tests and verify RED**

```bash
npm test -- src/renderer/services/circle/DesktopCircleClient.test.ts src/renderer/services/circle/MockCircleClient.test.ts
```

- [ ] **Step 3: Implement production client methods**

Add an independent `detailsInFlight: Promise<CircleDetails | null> | null` cache using the same clear-on-resolve/reject pattern as `overviewInFlight`.

Add:

```ts
private invalidateCircleReads(): void {
  this.overviewInFlight = null
  this.detailsInFlight = null
}
```

Use it after select/create/invite and every management mutation.

- [ ] **Step 4: Update MockCircleClient explicitly**

Provide deterministic mock details and mutations for tests/demo only. Do not introduce production fallback to mock data.

- [ ] **Step 5: Run focused tests + typecheck**

```bash
npm test -- src/renderer/services/circle/DesktopCircleClient.test.ts src/renderer/services/circle/MockCircleClient.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/services/circle
git commit -m "feat: add Circle management renderer client"
```

---

### Task 6: Members and Invitations management UI plus Manage navigation

**Files:**
- Create: `src/renderer/features/circles/CircleManagement.tsx`
- Create: `src/renderer/features/circles/CircleManagement.css`
- Create: `src/renderer/features/circles/CircleManagement.test.tsx`
- Modify: `src/renderer/features/circles/MyCircles.tsx`
- Modify: `src/renderer/features/circles/MyCircles.test.tsx`
- Modify: `src/renderer/app/App.tsx`
- Modify: `src/renderer/app/App.test.tsx`

**Interfaces:**
- Component:

```ts
export function CircleManagement({ initialSection }: {
  initialSection: 'members' | 'invitations'
})
```

- Routes:

```tsx
<Route path="/members" element={<CircleManagement initialSection="members" />} />
<Route path="/invitations" element={<CircleManagement initialSection="invitations" />} />
```

- My Circles Manage behavior:

```ts
await circle.selectCircle(item.id)
navigate('/members')
```

- [ ] **Step 1: Write RED route/page tests**

Assert `/members` and `/invitations` no longer render `PlaceholderPage`, and each route calls `getCircleDetails()`.

- [ ] **Step 2: Write RED management rendering tests**

Cover:
- header shows active Circle name, role, real member count, real pending count;
- confirmed members render name/email/role;
- pending invitations render email/role/status;
- owner sees Invite + invitation actions + member remove controls;
- owner never sees Leave Circle;
- non-owner sees Leave Circle but no owner mutation controls;
- `null` details renders safe “Choose a Circle” state linking to `/circles`;
- load failure shows retry without raw error text.

- [ ] **Step 3: Write RED My Circles Manage test**

Assert clicking `Manage <Circle>` calls protected `selectCircle(circleId)` before navigation to `/members`, and selection failure stays on My Circles with safe copy.

- [ ] **Step 4: Run UI tests and verify RED**

```bash
npm test -- src/renderer/features/circles/CircleManagement.test.tsx src/renderer/features/circles/MyCircles.test.tsx src/renderer/app/App.test.tsx
```

Expected: FAIL because the page/routes/Manage action do not exist.

- [ ] **Step 5: Implement the page shell and authoritative load**

Use existing brand palette/classes as reference. Keep member and invitation sections in the same component so sidebar routes share one management data source.

- [ ] **Step 6: Reuse existing InviteMemberDialog**

For owner Invite, open `InviteMemberDialog` with active Circle ID/name from `CircleDetails`. On success, reload authoritative details.

- [ ] **Step 7: Implement My Circles Manage navigation**

Add `Manage` beside `Open Circle` for every Circle. It is a navigation action, not owner-only; all members may view management details.

- [ ] **Step 8: Run UI tests + typecheck**

```bash
npm test -- src/renderer/features/circles/CircleManagement.test.tsx src/renderer/features/circles/MyCircles.test.tsx src/renderer/app/App.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/features/circles src/renderer/app/App.tsx src/renderer/app/App.test.tsx
git commit -m "feat: add Circle members and invitations views"
```

---

### Task 7: Confirmations, safe error mapping, boundary hardening, docs, and final verification

**Files:**
- Create: `src/renderer/features/circles/ConfirmCircleActionDialog.tsx`
- Create: `src/renderer/features/circles/ConfirmCircleActionDialog.test.tsx`
- Modify: `src/renderer/features/circles/CircleManagement.tsx`
- Modify: `src/renderer/features/circles/CircleManagement.test.tsx`
- Modify: `scripts/verify-boundaries.mjs`
- Modify: `README.md`

**Interfaces:**
- Confirmation component:

```ts
export interface ConfirmCircleActionDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  busyLabel: string
  onCancel(): void
  onConfirm(): Promise<void>
}
```

- Required safe UI error mapping:

```text
Only the Circle owner can manage invitations.
Only the Circle owner can remove members.
The Circle owner cannot be removed.
Circle owners cannot leave their own Circle.
That member is no longer in this Circle.
That invitation is no longer pending.
We couldn't resend the invitation. Please try again.
We couldn't update the Circle. Please try again.
```

- [ ] **Step 1: Write RED confirmation tests**

Prove remove/cancel/leave do nothing until confirmation, duplicate confirm clicks are blocked while busy, Cancel closes without mutation, and successful mutation reloads authoritative details.

- [ ] **Step 2: Write RED safe-error tests**

Inject service errors containing SQL/SMTP/internal IDs/API details and assert none appear in rendered copy. Assert known authorization/stale-state errors map to the approved stable messages.

- [ ] **Step 3: Implement confirmations and error mapping**

Use the exact destructive copy from the spec. Resend is not destructive and does not need a confirmation; it still needs busy-state duplicate-submit protection.

- [ ] **Step 4: Strengthen boundary verifier**

Add production checks that reject management renderer/public-contract occurrences of trusted identity/secrets such as:

```text
fromUserId
serverUserId
invitationId
tempPassword
X-Kin-Keepers-Key
/api/group/
```

Allow legacy endpoint literals only in the compatibility adapter/main tests as already established. Do not block safe `personId`.

- [ ] **Step 5: Update README**

Document:
- real Members/Invitations management;
- active Circle as the single management selection;
- owner-only resend/cancel/remove;
- non-owner leave;
- main-only identity resolution;
- intentionally deferred rename/delete/ownership/tree editing.

- [ ] **Step 6: Run focused tests**

```bash
npm test -- src/renderer/features/circles/ConfirmCircleActionDialog.test.tsx src/renderer/features/circles/CircleManagement.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run full verification gate**

```bash
npm ci
npm audit --audit-level=high
npm run check
```

`npm run check` must pass:

```text
typecheck
all Vitest tests
architecture boundary verifier
Electron build
Vite build
```

- [ ] **Step 8: Review full feature diff**

Check specifically for:
- raw shared IDs crossing into renderer;
- actor identity accepted from renderer;
- invitation token/temp-password leaks;
- owner determination based only on descriptive role;
- stale active-Circle behavior;
- optimistic destructive removal;
- legacy endpoint strings outside adapter quarantine;
- raw backend errors in UI.

Fix any Important/Critical finding with a RED regression test before implementation.

- [ ] **Step 9: Commit final hardening**

```bash
git add src/renderer/features/circles scripts/verify-boundaries.mjs README.md
git commit -m "chore: harden Circle member management"
```

- [ ] **Step 10: Verify exact feature head in GitHub Actions**

Require exact-head success before opening/merging the PR. Record final test count, audit result, boundary-verifier result, Electron build, and Vite build in the PR body.

---

## Completion Criteria

The slice is complete only when all are true:

- `/members` and `/invitations` are real active-Circle views.
- My Circles has protected Manage navigation.
- member/pending invitation counts are authoritative.
- owner can resend/cancel pending invitations and remove non-owner members.
- non-owner can leave Circle.
- owner cannot remove self/owner and cannot leave own Circle.
- renderer sends only safe person handles/business operations.
- main re-fetches authoritative identity before every mutation.
- no raw secrets/internal IDs/backend errors cross into React.
- destructive operations require confirmation and authoritative refresh.
- full CI/security/build gate is green on exact feature head.
