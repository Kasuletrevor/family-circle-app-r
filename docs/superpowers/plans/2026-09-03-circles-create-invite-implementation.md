# My Circles + Create Circle + Invite Member Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/circles` placeholder with a real My Circles experience that can list/open Circles, create a Circle, bootstrap a missing shared identity safely, and let Circle owners invite members using a fixed family-role dropdown.

**Architecture:** Keep Jose's current Circle API behind `LegacyCircleAuthAdapter`. The Electron main process restores the protected session, resolves the local user, owns all shared-service identity, validates permissions/roles, and exposes only safe typed DTOs through IPC/preload. The renderer uses `DesktopCircleClient`; it never sends acting-user IDs, API credentials, legacy endpoint URLs, invitation tokens, or temporary passwords.

**Tech Stack:** Electron 44, React 19, TypeScript 7, React Router 7, Vitest 4, jsdom 30, Node `node:sqlite`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-03-circles-create-invite-design.md`

## Global Constraints

- Preserve Jose's current Circle API; do not create `/v2` backend work in this slice.
- `Circle owner` is an authorization state, never an invitation-role option.
- Fixed invitation roles are exactly: `Family member`, `Parent`, `Child`, `Spouse / Partner`, `Sibling`, `Grandparent`, `Grandchild`, `Guardian / Caregiver`.
- Final renderer/public Circle contracts must not supply or receive `fromUserId`, `serverUserId`, `ownerId`, raw shared `userId`, `CIRCLE_API_KEY`, `X-Kin-Keepers-Key`, legacy endpoint URLs, invitation tokens, or temporary passwords.
- Every shared-data mutation derives the acting identity from the protected desktop session and persisted local user record.
- Shared identity bootstrap uses the authenticated user's persisted name/email, persists the returned `server_user_id`, and keeps that valid identity if Circle creation subsequently fails.
- `active_circle_id` is local viewer preference only; ownership/membership remain server-owned.
- Open Circle must validate current membership before persisting `active_circle_id`.
- Member counts shown on My Circles must be authoritative per Circle; never reuse the active Circle's member count for another Circle.
- No optimistic remote success state; invalidate/read authoritative Circle state after confirmed writes.
- Keep current Electron security settings: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- No new direct `fetch` in renderer Circle feature code.
- Every task below must end with its targeted tests and `npm run typecheck` green before committing.
- Final exact head must pass `npm audit --audit-level=high` and `npm run check`.

---

## File Structure

### Main-process domain and persistence

- `src/main/circle/circleModels.ts` — **create**; internal legacy/shared-service records that may contain shared IDs. Never imported by renderer/preload.
- `src/main/circle/LegacyCircleAuthAdapter.ts` — extend with shared registration, create Circle, invite member; normalize Jose payloads.
- `src/main/circle/CircleService.ts` — extend protected read/write orchestration, safe DTO mapping, active-Circle selection, accurate multi-Circle summaries.
- `src/main/circle/CircleService.test.ts` — service TDD for session scoping, bootstrap, permissions, selection, safe reads.
- `src/main/circle/LegacyCircleAuthAdapter.test.ts` and `src/main/circle/LegacyCircleReadAdapter.test.ts` — compatibility TDD.
- `src/main/auth/UserRepository.ts` — persist `server_user_id` and local `active_circle_id` through narrow setters.
- `src/main/auth/UserRepository.test.ts` — persistence tests.
- `src/main/database/migrations.ts` and `src/main/database/migrations.test.ts` — add/migrate `active_circle_id` without damaging legacy databases.
- `src/main/circle/circleIpc.ts` and `src/main/circle/circleIpc.test.ts` — typed no-identity public channels.
- `src/main/main.ts` — continue composing the same repository/session/adapter into the expanded CircleService.

### Shared/preload contract

- `src/shared/desktopApi.ts` — fixed family-role allow-list/type, safe Circle list/create/select/invite DTOs, and final removal of legacy shared IDs from renderer-facing read DTOs in Task 3.
- `src/preload/createDesktopApi.ts` and `src/preload/createDesktopApi.test.ts` — expose only approved Circle capabilities.

### Renderer service and feature

- `src/renderer/services/circle/CircleClient.ts` — add list/select/create/invite methods.
- `src/renderer/services/circle/DesktopCircleClient.ts` and `.test.ts` — call preload capabilities, map safe DTOs, invalidate in-flight overview after writes/selection.
- `src/renderer/services/circle/MockCircleClient.ts` and `.test.ts` — keep test fixture compatible with expanded interface; never use it in production composition.
- `src/renderer/features/circles/MyCircles.tsx` — **create**; list/empty/loading/error state and dialog orchestration.
- `src/renderer/features/circles/MyCircles.test.tsx` — **create**.
- `src/renderer/features/circles/CreateCircleDialog.tsx` — **create**; name form.
- `src/renderer/features/circles/CreateCircleDialog.test.tsx` — **create**.
- `src/renderer/features/circles/InviteMemberDialog.tsx` — **create**; email + fixed role form.
- `src/renderer/features/circles/InviteMemberDialog.test.tsx` — **create**.
- `src/renderer/features/circles/MyCircles.css` — **create**; reuse brand tokens, no new palette.
- `src/renderer/app/App.tsx` and `src/renderer/app/App.test.tsx` — replace `/circles` placeholder with `MyCircles` route.
- `src/renderer/features/home/Home.tsx` / test — only change the existing no-Circle action/copy if needed to navigate to `/circles`; no broader Home scope.

### Architecture/docs/CI

- `scripts/verify-boundaries.mjs` — forbid shared identities/secrets/legacy paths in public Circle surfaces.
- `.github/workflows/desktop-shell-ci.yml` — include `feature/circles-create-invite` in push branches so implementation commits get the full gate.
- `README.md` — document Create/Invite boundary and fixed-role behavior.

---

### Task 1: Local viewer preference, write DTOs, internal models, and branch CI

**Files:**
- Create: `src/main/circle/circleModels.ts`
- Modify: `src/shared/desktopApi.ts`
- Modify: `src/main/database/migrations.ts`
- Modify: `src/main/database/migrations.test.ts`
- Modify: `src/main/auth/UserRepository.ts`
- Modify: `src/main/auth/UserRepository.test.ts`
- Modify: `.github/workflows/desktop-shell-ci.yml`

**Interfaces:**
- Produces `InvitationFamilyRole` and `INVITATION_FAMILY_ROLES`.
- Produces `CircleListItem`, `CreateCircleInput`, `CreateCircleResult`, `InviteMemberInput`, `InviteMemberResult`.
- Produces internal `CircleGroupInternal`, `CircleTreeInternal`, `CircleTreePersonInternal` while keeping the current read DTO shape temporarily compatible until Task 3 sanitizes it atomically with `CircleService`.
- Produces `UserRecord.activeCircleId`, `UserRepository.setServerUserId(userId, serverUserId)`, and `UserRepository.setActiveCircleId(userId, circleId)`.

- [ ] **Step 1: Write failing migration/repository tests**

In `migrations.test.ts` add:

```ts
it('adds active_circle_id to legacy users without losing existing data', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, password TEXT)`)
  db.exec(`INSERT INTO users (id, email, password) VALUES (7, 'owner@example.test', 'hash')`)

  runMigrations(db)

  const columns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
  expect(columns.map((column) => column.name)).toContain('active_circle_id')
  expect(db.prepare('SELECT email FROM users WHERE id = 7').get()).toEqual({ email: 'owner@example.test' })
})
```

In `UserRepository.test.ts` add:

```ts
await users.setServerUserId(user.id, '88')
await users.setActiveCircleId(user.id, 'circle-a')
const record = await users.getRecordById(user.id)
expect(record?.serverUserId).toBe('88')
expect(record?.activeCircleId).toBe('circle-a')
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/database/migrations.test.ts src/main/auth/UserRepository.test.ts
```

Expected: FAIL because `active_circle_id`, `activeCircleId`, and the two setters do not exist.

- [ ] **Step 3: Add fixed role/write contracts without changing current read DTOs yet**

In `src/shared/desktopApi.ts` add:

```ts
export const INVITATION_FAMILY_ROLES = [
  'Family member',
  'Parent',
  'Child',
  'Spouse / Partner',
  'Sibling',
  'Grandparent',
  'Grandchild',
  'Guardian / Caregiver',
] as const

export type InvitationFamilyRole = typeof INVITATION_FAMILY_ROLES[number]

export interface CircleListItem {
  id: string
  name: string
  role: string
  memberCount: number
  isActive: boolean
}

export interface CreateCircleInput { name: string }
export interface CreateCircleResult { circleId: string }

export interface InviteMemberInput {
  circleId: string
  email: string
  role: InvitationFamilyRole
}

export interface InviteMemberResult {
  outcome: 'sent' | 'already-pending' | 'already-member' | 'delivery-failed'
}
```

Do **not** remove `ownerId` or tree `userId` from the existing read DTOs in this task; Task 3 removes them together with service sanitization so this task stays green.

Create `src/main/circle/circleModels.ts`:

```ts
export interface CircleGroupInternal {
  id: string
  name: string
  ownerId: string
  role: string
}

export interface CircleTreePersonInternal {
  id: string
  kind: 'user' | 'placeholder' | 'invite'
  userId: string | null
  name: string
  email: string | null
  role: string
}

export interface CircleTreeInternal {
  group: { id: string; name: string; ownerId: string }
  people: CircleTreePersonInternal[]
  relations: Array<{ id: string; kind: string; aPersonId: string; bPersonId: string }>
  positions: Array<{ personId: string; x: number; y: number }>
}
```

- [ ] **Step 4: Implement migration and repository setters**

Add `active_circle_id TEXT` to fresh users and legacy migration. Include it in `UserRow`, both record queries, and `UserRecord`:

```ts
export interface UserRecord {
  user: AuthUser
  passwordHash: string
  serverUserId: string | null
  activeCircleId: string | null
  sessionVersion: number
  invitation: null | { groupId: string; groupName: string; role: string }
}
```

Add:

```ts
async setServerUserId(userId: number, serverUserId: string): Promise<void> {
  const value = String(serverUserId).trim()
  if (!value) throw new Error('Shared user ID is required')
  const result = this.db.prepare(
    'UPDATE users SET server_user_id = ?, updated_at = ? WHERE id = ?',
  ).run(value, Date.now(), userId)
  if (Number(result.changes) !== 1) throw new Error('User not found')
}

async setActiveCircleId(userId: number, circleId: string | null): Promise<void> {
  const value = circleId == null ? null : String(circleId).trim() || null
  const result = this.db.prepare(
    'UPDATE users SET active_circle_id = ?, updated_at = ? WHERE id = ?',
  ).run(value, Date.now(), userId)
  if (Number(result.changes) !== 1) throw new Error('User not found')
}
```

- [ ] **Step 5: Enable branch CI and verify green**

Add `feature/circles-create-invite` under workflow `push.branches`, then run:

```bash
npx vitest run src/main/database/migrations.test.ts src/main/auth/UserRepository.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/desktop-shell-ci.yml src/shared/desktopApi.ts src/main/circle/circleModels.ts src/main/database/migrations.ts src/main/database/migrations.test.ts src/main/auth/UserRepository.ts src/main/auth/UserRepository.test.ts
git commit -m "feat: add circle write contracts and viewer preference"
```

---

### Task 2: Legacy adapter write compatibility

**Files:**
- Modify: `src/main/circle/LegacyCircleAuthAdapter.ts`
- Modify: `src/main/circle/LegacyCircleAuthAdapter.test.ts`
- Modify: `src/main/circle/LegacyCircleReadAdapter.test.ts`

**Interfaces:**
- `listGroups(serverUserId): Promise<CircleGroupInternal[]>`
- `getTree(groupId, serverUserId): Promise<CircleTreeInternal>`
- `ensureSharedUser(input: { email: string; name: string }): Promise<{ serverUserId: string }>`
- `createCircle(input: { serverUserId: string; name: string }): Promise<CircleGroupInternal>`
- `inviteMember(input: { serverUserId: string; circleId: string; email: string; role: InvitationFamilyRole }): Promise<InviteMemberResult>`

- [ ] **Step 1: Write failing adapter tests**

Shared registration request:

```ts
await adapter.ensureSharedUser({ email: 'owner@example.test', name: 'Owner Name' })
expect(fetcher).toHaveBeenCalledWith(
  expect.stringContaining('/api/register'),
  expect.objectContaining({ body: JSON.stringify({ email: 'owner@example.test', name: 'Owner Name' }) }),
)
```

Circle create normalization:

```ts
const created = await adapter.createCircle({ serverUserId: '88', name: 'Kasule Family' })
expect(created).toEqual({ id: 'circle-1', name: 'Kasule Family', ownerId: '88', role: 'Circle owner' })
```

Invite tests must cover `sent`, `already-pending`, `already-member`, `delivery-failed`. Include a server response containing `token`, `tempPassword`, and `emailPayload`; assert the returned object is only `{ outcome: 'sent' }`.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/circle/LegacyCircleAuthAdapter.test.ts src/main/circle/LegacyCircleReadAdapter.test.ts
```

Expected: FAIL because write methods/internal return types do not exist.

- [ ] **Step 3: Move legacy reads to internal model return types**

Change adapter imports to `circleModels.ts`; `CircleGroupInternal` and `CircleTreeInternal` are structurally compatible with the current Task-1 read DTOs, so existing consumers continue to typecheck until Task 3 performs the public sanitization.

- [ ] **Step 4: Implement `ensureSharedUser()` and `createCircle()`**

Use existing `postJson()`:

```ts
async ensureSharedUser(input: { email: string; name: string }): Promise<{ serverUserId: string }> {
  const registration = await this.postJson<RegistrationResponse>('/api/register', {
    email: normalizeEmail(input.email),
    name: String(input.name).trim(),
  })
  const serverUserId = String(registration.user?.id ?? '').trim()
  if (!serverUserId) throw new Error('The shared account could not be created')
  return { serverUserId }
}
```

`createCircle()` posts exactly `{ fromUserId: serverUserId, name }` to `/api/group/create` and returns `{ id, name, ownerId, role: 'Circle owner' }`.

- [ ] **Step 5: Implement invite normalization**

Post exactly:

```ts
{
  fromUserId: input.serverUserId,
  groupId: input.circleId,
  email: normalizeEmail(input.email),
  role: input.role,
}
```

Normalize:

```ts
if (data.alreadyMember) return { outcome: 'already-member' }
if (data.emailSent === false) return { outcome: 'delivery-failed' }
if (data.alreadyPending) return { outcome: 'already-pending' }
return { outcome: 'sent' }
```

Never return `data.invitation`, `token`, `tempPassword`, or `emailPayload`.

- [ ] **Step 6: Verify green**

```bash
npx vitest run src/main/circle/LegacyCircleAuthAdapter.test.ts src/main/circle/LegacyCircleReadAdapter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/circle/LegacyCircleAuthAdapter.ts src/main/circle/LegacyCircleAuthAdapter.test.ts src/main/circle/LegacyCircleReadAdapter.test.ts
git commit -m "feat: add legacy circle mutation adapter"
```

---

### Task 3: Session-scoped CircleService, safe read DTOs, selection, and accurate summaries

**Files:**
- Modify: `src/main/circle/CircleService.ts`
- Modify: `src/main/circle/CircleService.test.ts`
- Modify: `src/shared/desktopApi.ts`
- Modify: `src/renderer/services/circle/DesktopCircleClient.ts`
- Modify: `src/renderer/services/circle/DesktopCircleClient.test.ts`

**Interfaces:**
- `getOverview(): Promise<CircleOverview>`
- `getMyCircles(): Promise<CircleListItem[]>`
- `selectCircle(circleId: string): Promise<{ success: true }>`
- `createCircle(input: CreateCircleInput): Promise<CreateCircleResult>`
- `inviteMember(input: InviteMemberInput): Promise<InviteMemberResult>`

This task is the atomic boundary change that removes shared-service IDs from renderer-facing read DTOs while keeping them in `circleModels.ts` inside main.

- [ ] **Step 1: Write failing identity/session/bootstrap tests**

```ts
await expect(service.createCircle({ name: 'Kasule Family' }))
  .rejects.toThrow('Please sign in')
```

For a local user with no shared ID:

```ts
await service.createCircle({ name: 'Kasule Family' })
expect(circle.ensureSharedUser).toHaveBeenCalledWith({
  email: 'owner@example.test',
  name: 'Owner Name',
})
expect(users.setServerUserId).toHaveBeenCalledWith(7, '88')
expect(circle.createCircle).toHaveBeenCalledWith({ serverUserId: '88', name: 'Kasule Family' })
expect(users.setActiveCircleId).toHaveBeenCalledWith(7, 'circle-1')
```

Add a case where bootstrap succeeds but Circle create rejects; assert `setServerUserId(7, '88')` remains called and no clearing setter follows.

- [ ] **Step 2: Write failing safe-read/list/selection/invite tests**

Safe overview assertion must prove no shared IDs cross:

```ts
const overview = await service.getOverview()
expect(JSON.stringify(overview)).not.toContain('ownerId')
expect(JSON.stringify(overview)).not.toContain('userId')
```

Accurate list:

```ts
expect(await service.getMyCircles()).toEqual([
  { id: 'circle-a', name: 'A Family', role: 'Circle owner', memberCount: 3, isActive: true },
  { id: 'circle-b', name: 'B Family', role: 'Sibling', memberCount: 8, isActive: false },
])
```

Selection: membership-confirmed `circle-b` persists; `not-mine` rejects and does not persist.

Invite: non-owner rejects before adapter call; runtime role `'Administrator'` rejects even when cast through TypeScript.

- [ ] **Step 3: Run RED**

```bash
npx vitest run src/main/circle/CircleService.test.ts src/renderer/services/circle/DesktopCircleClient.test.ts
```

Expected: FAIL for missing methods and unsafe current read DTO fields.

- [ ] **Step 4: Add protected current-record helper and internal read port**

Use:

```ts
private async requireCurrentRecord(): Promise<UserRecord> {
  const current = await this.sessions.restore()
  if (!current) throw new Error('Please sign in to manage your family circles')
  const record = await this.users.getRecordById(current.id)
  if (!record) throw new Error('Please sign in again to manage your family circles')
  return record
}
```

`CircleReadPort`/write port methods consume/return internal main-only models. No public method accepts acting identity.

- [ ] **Step 5: Remove shared IDs from public read DTOs and sanitize in service**

In `desktopApi.ts` change renderer-facing read records to:

```ts
export interface CircleGroupRecord {
  id: string
  name: string
  role: string
}

export interface CircleTreePersonRecord {
  id: string
  kind: 'user' | 'placeholder' | 'invite'
  name: string
  email: string | null
  role: string
}

export interface CircleTreeRecord {
  group: { id: string; name: string }
  people: CircleTreePersonRecord[]
  relations: CircleTreeRelationRecord[]
  positions: CircleTreePositionRecord[]
}
```

In `CircleService`, compute viewer identity before stripping:

```ts
const viewerPersonId = tree.people.find((person) => person.userId === serverUserId)?.id ?? null
```

Map groups/tree to safe records without `ownerId`/`userId`.

Update `DesktopCircleClient` and its tests only as required by this safe DTO change; it must continue using `viewerPersonId` rather than raw user IDs.

- [ ] **Step 6: Implement active selection and stale fallback**

Choose active Circle:

```ts
const activeCircle = groups.find((item) => item.id === record.activeCircleId)
  ?? groups.find((item) => item.id === record.invitation?.groupId)
  ?? groups[0]
```

If a persisted preference is stale, persist the chosen fallback. If no Circles remain and `activeCircleId` is non-null, clear it.

`selectCircle(circleId)` must call `listGroups(serverUserId)` and verify membership before `setActiveCircleId`.

- [ ] **Step 7: Implement accurate `getMyCircles()`**

```ts
const trees = await Promise.all(groups.map((group) => this.circle.getTree(group.id, serverUserId)))
return groups.map((group, index) => ({
  id: group.id,
  name: group.name,
  role: group.role,
  memberCount: trees[index].people.filter((person) => person.kind === 'user').length,
  isActive: group.id === activeCircleId,
}))
```

Do not reuse the active tree count for another Circle.

- [ ] **Step 8: Implement create/invite service methods**

Create validation:

```ts
const name = String(input.name ?? '').trim()
if (!name) throw new Error('Circle name is required')
if (name.length > 120) throw new Error('Circle name is too long')
```

When `serverUserId` is absent, call `ensureSharedUser`, persist it immediately, then create. Persist created Circle ID as active only after successful create.

Invite validation:

```ts
const allowedRoles = INVITATION_FAMILY_ROLES as readonly string[]
if (!allowedRoles.includes(String(input.role))) throw new Error('Choose a valid family role')
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email).trim())) {
  throw new Error('Enter a valid email address')
}
```

Load internal groups and require both matching `circleId` and `group.ownerId === serverUserId`; otherwise throw `Only the Circle owner can invite members`.

- [ ] **Step 9: Verify green**

```bash
npx vitest run src/main/circle/CircleService.test.ts src/renderer/services/circle/DesktopCircleClient.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/main/circle/CircleService.ts src/main/circle/CircleService.test.ts src/shared/desktopApi.ts src/renderer/services/circle/DesktopCircleClient.ts src/renderer/services/circle/DesktopCircleClient.test.ts
git commit -m "feat: add protected circle management service"
```

---

### Task 4: IPC and preload mutation boundary

**Files:**
- Modify: `src/main/circle/circleIpc.ts`
- Modify: `src/main/circle/circleIpc.test.ts`
- Modify: `src/shared/desktopApi.ts`
- Modify: `src/preload/createDesktopApi.ts`
- Modify: `src/preload/createDesktopApi.test.ts`
- Modify: `src/main/main.ts` only if service interface composition requires a type-only adjustment.

**Interfaces:**
- `circle:get-overview`
- `circle:get-my-circles`
- `circle:select`
- `circle:create`
- `circle:invite-member`

- [ ] **Step 1: Write failing IPC tests**

```ts
await handlers.get('circle:create')?.({}, { name: 'Kasule Family' })
expect(service.createCircle).toHaveBeenCalledWith({ name: 'Kasule Family' })
```

```ts
await handlers.get('circle:invite-member')?.({}, {
  circleId: 'circle-a',
  email: 'relative@example.test',
  role: 'Sibling',
})
expect(service.inviteMember).toHaveBeenCalledWith({
  circleId: 'circle-a',
  email: 'relative@example.test',
  role: 'Sibling',
})
```

No handler accepts an acting-user parameter.

- [ ] **Step 2: Write failing preload tests**

```ts
await api.circle.getMyCircles()
expect(invoke).toHaveBeenCalledWith('circle:get-my-circles')

await api.circle.selectCircle('circle-a')
expect(invoke).toHaveBeenCalledWith('circle:select', 'circle-a')

await api.circle.createCircle({ name: 'Kasule Family' })
expect(invoke).toHaveBeenCalledWith('circle:create', { name: 'Kasule Family' })

await api.circle.inviteMember({ circleId: 'circle-a', email: 'relative@example.test', role: 'Sibling' })
expect(invoke).toHaveBeenCalledWith('circle:invite-member', {
  circleId: 'circle-a',
  email: 'relative@example.test',
  role: 'Sibling',
})
```

- [ ] **Step 3: Run RED**

```bash
npx vitest run src/main/circle/circleIpc.test.ts src/preload/createDesktopApi.test.ts
```

Expected: FAIL because channels/capabilities do not exist.

- [ ] **Step 4: Extend public API exactly**

```ts
circle: {
  getOverview(): Promise<CircleOverview>
  getMyCircles(): Promise<CircleListItem[]>
  selectCircle(circleId: string): Promise<{ success: true }>
  createCircle(input: CreateCircleInput): Promise<CreateCircleResult>
  inviteMember(input: InviteMemberInput): Promise<InviteMemberResult>
}
```

- [ ] **Step 5: Register IPC and preload methods**

Handlers call only `CircleService`. Do not normalize identities or legacy payloads in IPC/preload.

- [ ] **Step 6: Verify green**

```bash
npx vitest run src/main/circle/circleIpc.test.ts src/preload/createDesktopApi.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/circle/circleIpc.ts src/main/circle/circleIpc.test.ts src/shared/desktopApi.ts src/preload/createDesktopApi.ts src/preload/createDesktopApi.test.ts src/main/main.ts
git commit -m "feat: expose safe circle management ipc"
```

---

### Task 5: DesktopCircleClient list/select/create/invite and cache invalidation

**Files:**
- Modify: `src/renderer/services/circle/CircleClient.ts`
- Modify: `src/renderer/services/circle/DesktopCircleClient.ts`
- Modify: `src/renderer/services/circle/DesktopCircleClient.test.ts`
- Modify: `src/renderer/services/circle/MockCircleClient.ts`
- Modify: `src/renderer/services/circle/MockCircleClient.test.ts`

**Interfaces:**

```ts
export interface CircleClient {
  getHomeSnapshot(): Promise<HomeSnapshot>
  getMyCircles(): Promise<CircleSummary[]>
  getShellSnapshot(): Promise<ShellSnapshot>
  selectCircle(circleId: string): Promise<void>
  createCircle(input: CreateCircleInput): Promise<CreateCircleResult>
  inviteMember(input: InviteMemberInput): Promise<InviteMemberResult>
}
```

- [ ] **Step 1: Write failing renderer-service tests**

`getMyCircles()` must call `window.familyCircle.circle.getMyCircles()` rather than deriving all counts from one overview tree.

Selection/create must invalidate the next overview read. Use a mocked overview provider and assert a fresh call after mutation.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/renderer/services/circle/DesktopCircleClient.test.ts src/renderer/services/circle/MockCircleClient.test.ts
```

Expected: FAIL due missing methods/new list source.

- [ ] **Step 3: Implement mutation/list methods and invalidation**

Add:

```ts
private invalidateOverview(): void {
  this.overviewInFlight = null
}
```

`selectCircle()` awaits preload selection then invalidates. `createCircle()` awaits create, invalidates, and returns result. `inviteMember()` awaits invite, invalidates, and returns normalized result. `getMyCircles()` maps safe authoritative `CircleListItem[]` without inventing counts.

- [ ] **Step 4: Keep MockCircleClient test-only compatible**

Implement deterministic fixture methods only for interface compliance. Do not import MockCircleClient into production `src/renderer/app/services.tsx`.

- [ ] **Step 5: Verify green**

```bash
npx vitest run src/renderer/services/circle/DesktopCircleClient.test.ts src/renderer/services/circle/MockCircleClient.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/services/circle/CircleClient.ts src/renderer/services/circle/DesktopCircleClient.ts src/renderer/services/circle/DesktopCircleClient.test.ts src/renderer/services/circle/MockCircleClient.ts src/renderer/services/circle/MockCircleClient.test.ts
git commit -m "feat: add desktop circle management client"
```

---

### Task 6: Real My Circles page and Open Circle behavior

**Files:**
- Create: `src/renderer/features/circles/MyCircles.tsx`
- Create: `src/renderer/features/circles/MyCircles.test.tsx`
- Create: `src/renderer/features/circles/MyCircles.css`
- Modify: `src/renderer/app/App.tsx`
- Modify: `src/renderer/app/App.test.tsx`
- Modify: `src/renderer/features/home/Home.tsx` and `.test.tsx` only if the existing no-Circle CTA needs routing to `/circles`.

**Interfaces:**
- Consumes `getMyCircles()` and `selectCircle()`.
- Produces `/circles` route, real cards, empty/loading/error state, Open Circle navigation.

- [ ] **Step 1: Write failing page tests**

```ts
expect(await screen.findByText('Kasule Family')).toBeInTheDocument()
expect(screen.getByText('8 members')).toBeInTheDocument()
expect(screen.getByRole('button', { name: 'Invite to Kasule Family' })).toBeInTheDocument()
expect(screen.queryByRole('button', { name: 'Invite to Ramos Family' })).not.toBeInTheDocument()
```

Empty state:

```ts
expect(await screen.findByRole('heading', { name: 'Your family starts here' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: 'Create your first Circle' })).toBeInTheDocument()
```

Open behavior:

```ts
await user.click(screen.getByRole('button', { name: 'Open Ramos Family' }))
expect(circle.selectCircle).toHaveBeenCalledWith('circle-b')
expect(navigate).toHaveBeenCalledWith('/')
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/renderer/features/circles/MyCircles.test.tsx src/renderer/app/App.test.tsx
```

Expected: FAIL because `MyCircles` and route do not exist.

- [ ] **Step 3: Implement route and states**

Remove `/circles` from `placeholderRoutes` and add:

```tsx
<Route path="/circles" element={<MyCircles />} />
```

Load via `useAppServices().circle.getMyCircles()` with an unmounted guard; render loading, retryable error, empty state, or cards. Owner action is based only on `circle.role === 'Circle owner'` from normalized main-process data.

- [ ] **Step 4: Implement Open Circle**

Disable the clicked action while selection is in flight, await `selectCircle(id)`, then `navigate('/')`. Stay on the page and show safe inline copy if selection fails.

- [ ] **Step 5: Style with existing tokens**

Use existing CSS variables only; no new palette constants. Keep usable within the existing 1180px minimum app window.

- [ ] **Step 6: Verify green**

```bash
npx vitest run src/renderer/features/circles/MyCircles.test.tsx src/renderer/app/App.test.tsx src/renderer/features/home/Home.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/features/circles/MyCircles.tsx src/renderer/features/circles/MyCircles.test.tsx src/renderer/features/circles/MyCircles.css src/renderer/app/App.tsx src/renderer/app/App.test.tsx src/renderer/features/home/Home.tsx src/renderer/features/home/Home.test.tsx
git commit -m "feat: add real my circles page"
```

---

### Task 7: Create Circle dialog

**Files:**
- Create: `src/renderer/features/circles/CreateCircleDialog.tsx`
- Create: `src/renderer/features/circles/CreateCircleDialog.test.tsx`
- Modify: `src/renderer/features/circles/MyCircles.tsx`
- Modify: `src/renderer/features/circles/MyCircles.test.tsx`
- Modify: `src/renderer/features/circles/MyCircles.css`

**Interfaces:**
- Consumes `CircleClient.createCircle({ name })`.
- Success closes dialog and reloads authoritative Circle cards; main service already makes the created Circle active.

- [ ] **Step 1: Write failing validation/duplicate-submit tests**

```ts
await user.click(screen.getByRole('button', { name: 'Create Circle' }))
expect(createCircle).not.toHaveBeenCalled()
expect(screen.getByText('Circle name is required.')).toBeInTheDocument()
```

```ts
await user.type(screen.getByLabelText('Circle name'), 'A'.repeat(121))
await user.click(screen.getByRole('button', { name: 'Create Circle' }))
expect(screen.getByText('Circle name is too long.')).toBeInTheDocument()
```

Use a deferred promise, double-click submit, and assert one service call plus disabled submit.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/renderer/features/circles/CreateCircleDialog.test.tsx src/renderer/features/circles/MyCircles.test.tsx
```

Expected: FAIL because dialog does not exist.

- [ ] **Step 3: Implement controlled dialog**

```ts
interface CreateCircleDialogProps {
  open: boolean
  onClose(): void
  onCreated(circleId: string): Promise<void> | void
}
```

Trim and validate required/max 120 locally; call only `{ name }`.

- [ ] **Step 4: Map safe errors without erasing input**

```ts
'Circle name is required' -> 'Circle name is required.'
'Circle name is too long' -> 'Circle name is too long.'
otherwise -> "We couldn't create the Circle. Please try again."
```

Do not show raw network/stack text.

- [ ] **Step 5: Wire both create entry points and authoritative refresh**

Header `Create Circle` and empty-state `Create your first Circle` open the same dialog. After success close and reload `getMyCircles()`.

- [ ] **Step 6: Verify green**

```bash
npx vitest run src/renderer/features/circles/CreateCircleDialog.test.tsx src/renderer/features/circles/MyCircles.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/features/circles/CreateCircleDialog.tsx src/renderer/features/circles/CreateCircleDialog.test.tsx src/renderer/features/circles/MyCircles.tsx src/renderer/features/circles/MyCircles.test.tsx src/renderer/features/circles/MyCircles.css
git commit -m "feat: add create circle flow"
```

---

### Task 8: Invite Member fixed-role dialog

**Files:**
- Create: `src/renderer/features/circles/InviteMemberDialog.tsx`
- Create: `src/renderer/features/circles/InviteMemberDialog.test.tsx`
- Modify: `src/renderer/features/circles/MyCircles.tsx`
- Modify: `src/renderer/features/circles/MyCircles.test.tsx`
- Modify: `src/renderer/features/circles/MyCircles.css`

**Interfaces:**
- Consumes `INVITATION_FAMILY_ROLES` and `CircleClient.inviteMember()`.
- Only owner cards can open it; main independently re-verifies ownership.

- [ ] **Step 1: Write failing fixed-role tests**

```ts
const options = screen.getAllByRole('option').map((option) => option.textContent)
expect(options).toEqual([
  'Family member',
  'Parent',
  'Child',
  'Spouse / Partner',
  'Sibling',
  'Grandparent',
  'Grandchild',
  'Guardian / Caregiver',
])
expect(options).not.toContain('Circle owner')
```

Invalid email `bad-email` must not call service.

- [ ] **Step 2: Write failing outcome tests**

Parameterize exact messages:

```ts
[
  ['sent', 'Invitation sent.'],
  ['already-pending', 'An invitation is already pending.'],
  ['already-member', 'This person is already a member.'],
  ['delivery-failed', 'The invitation was created, but email delivery failed.'],
]
```

Assert service receives only `{ circleId, email, role }`.

- [ ] **Step 3: Run RED**

```bash
npx vitest run src/renderer/features/circles/InviteMemberDialog.test.tsx src/renderer/features/circles/MyCircles.test.tsx
```

Expected: FAIL because invite dialog does not exist.

- [ ] **Step 4: Implement invite dialog**

```ts
interface InviteMemberDialogProps {
  circle: { id: string; name: string }
  open: boolean
  onClose(): void
  onInvitationChanged(): Promise<void> | void
}
```

Default role is `Family member`. Validate email, disable duplicate submit, and call `circle.inviteMember()`.

- [ ] **Step 5: Render normalized outcomes only**

Never inspect/render token/temp-password fields. Refresh authoritative Circle data after `sent`, `already-pending`, or `delivery-failed`; refreshing after `already-member` is also allowed. Do not fabricate membership.

- [ ] **Step 6: Verify green**

```bash
npx vitest run src/renderer/features/circles/InviteMemberDialog.test.tsx src/renderer/features/circles/MyCircles.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/features/circles/InviteMemberDialog.tsx src/renderer/features/circles/InviteMemberDialog.test.tsx src/renderer/features/circles/MyCircles.tsx src/renderer/features/circles/MyCircles.test.tsx src/renderer/features/circles/MyCircles.css
git commit -m "feat: add fixed-role member invitations"
```

---

### Task 9: Boundary hardening, docs, and exact-head verification

**Files:**
- Modify: `scripts/verify-boundaries.mjs`
- Modify: `README.md`
- Test: entire repository

**Interfaces:**
- Produces enforcement preventing regression of approved architecture.

- [ ] **Step 1: Add boundary rules**

Verifier must reject:

```text
renderer Circle feature/service code containing fromUserId
renderer Circle feature/service code containing serverUserId
renderer/public shared Circle contract containing ownerId
renderer/public shared Circle tree person contract containing raw userId
renderer containing CIRCLE_API_KEY or X-Kin-Keepers-Key
renderer Circle feature containing direct fetch(
legacy Circle endpoint literals outside src/main/circle/LegacyCircleAuthAdapter.ts
MockCircleClient imported from production renderer app composition
```

Use current verifier path-scoping conventions; do not weaken existing rules.

- [ ] **Step 2: Run boundary verifier**

```bash
npm run verify:boundaries
```

Expected: PASS. If it fails, remove the leaked dependency/identity rather than adding an exception unless the exception is a test fixture already covered by current verifier conventions.

- [ ] **Step 3: Update README**

Document:

```text
React My Circles
  -> DesktopCircleClient
  -> typed preload
  -> CircleService (protected session + local active-circle preference)
  -> LegacyCircleAuthAdapter
  -> Jose current Circle API
```

State that Create Circle transparently bootstraps missing shared identity, roles are fixed descriptive labels, and Circle ownership is separate authorization.

- [ ] **Step 4: Run targeted feature suite**

```bash
npx vitest run \
  src/main/database/migrations.test.ts \
  src/main/auth/UserRepository.test.ts \
  src/main/circle/LegacyCircleAuthAdapter.test.ts \
  src/main/circle/LegacyCircleReadAdapter.test.ts \
  src/main/circle/CircleService.test.ts \
  src/main/circle/circleIpc.test.ts \
  src/preload/createDesktopApi.test.ts \
  src/renderer/services/circle/DesktopCircleClient.test.ts \
  src/renderer/services/circle/MockCircleClient.test.ts \
  src/renderer/features/circles/MyCircles.test.tsx \
  src/renderer/features/circles/CreateCircleDialog.test.tsx \
  src/renderer/features/circles/InviteMemberDialog.test.tsx \
  src/renderer/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run exact final gate**

```bash
npm ci
npm audit --audit-level=high
npm run check
```

Expected:

```text
npm audit: 0 high-or-greater vulnerabilities
TypeScript renderer: PASS
TypeScript Electron: PASS
Vitest: all tests PASS
Boundary verifier: PASS
Electron build: PASS
Vite renderer build: PASS
```

Require GitHub Actions on the exact final `feature/circles-create-invite` commit SHA to conclude `success` before calling the branch merge-ready.

- [ ] **Step 6: Review final diff for security-sensitive leakage**

Confirm:

```text
No renderer-provided acting identity
No shared owner/user IDs in public Circle DTOs
No token/temp password crossing desktop API
No legacy URL/header outside adapter
No fabricated counts or optimistic successful writes
No Circle owner in invite dropdown
No rename/delete/leave/remove/tree-edit mutation scope
```

- [ ] **Step 7: Commit docs/boundary changes**

```bash
git add scripts/verify-boundaries.mjs README.md
git commit -m "docs: secure circle management boundaries"
```

- [ ] **Step 8: Prepare PR, do not merge without user instruction**

Create a PR from `feature/circles-create-invite` to `main` pinned to the verified final head. Include exact final test count, build status, audit result, boundary file counts, and excluded management operations. Stop before merge until the user asks to merge.
