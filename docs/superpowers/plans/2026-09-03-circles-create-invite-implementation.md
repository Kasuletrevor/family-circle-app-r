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
- React must not supply or receive `fromUserId`, `serverUserId`, `ownerId`, raw shared `userId`, `CIRCLE_API_KEY`, `X-Kin-Keepers-Key`, legacy endpoint URLs, invitation tokens, or temporary passwords.
- Every shared-data mutation derives the acting identity from the protected desktop session and persisted local user record.
- Shared identity bootstrap uses the authenticated user's persisted name/email, persists the returned `server_user_id`, and keeps that valid identity if Circle creation subsequently fails.
- `active_circle_id` is local viewer preference only; ownership/membership remain server-owned.
- Open Circle must validate current membership before persisting `active_circle_id`.
- Member counts shown on My Circles must be authoritative per Circle; never reuse the active Circle's member count for another Circle.
- No optimistic remote success state; invalidate/read authoritative Circle state after confirmed writes.
- Keep current Electron security settings: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- No new direct `fetch` in renderer Circle feature code.
- Final exact head must pass `npm audit --audit-level=high` and `npm run check`.

---

## File Structure

### Main-process domain and persistence

- `src/main/circle/circleModels.ts` — **create**; internal legacy/shared-service records that may contain shared IDs. Never imported by renderer/preload.
- `src/main/circle/LegacyCircleAuthAdapter.ts` — extend with shared registration, create Circle, invite member; normalize Jose payloads.
- `src/main/circle/CircleService.ts` — extend protected read/write orchestration, safe DTO mapping, active-Circle selection, accurate multi-Circle summaries.
- `src/main/circle/CircleService.test.ts` — service TDD for session scoping, bootstrap, permissions, selection, refresh-safe results.
- `src/main/circle/LegacyCircleAuthAdapter.test.ts` and `src/main/circle/LegacyCircleReadAdapter.test.ts` — compatibility TDD.
- `src/main/auth/UserRepository.ts` — persist `server_user_id` and local `active_circle_id` through narrow setters.
- `src/main/auth/UserRepository.test.ts` — persistence tests.
- `src/main/database/migrations.ts` and `src/main/database/migrations.test.ts` — add/migrate `active_circle_id` without damaging legacy databases.
- `src/main/circle/circleIpc.ts` and `src/main/circle/circleIpc.test.ts` — typed no-identity public mutation channels.
- `src/main/main.ts` — compose the same repository/session/adapter into the expanded CircleService.

### Shared/preload contract

- `src/shared/desktopApi.ts` — safe public DTOs, fixed family-role allow-list/type, Circle list/create/select/invite methods; remove legacy shared IDs from renderer-facing tree/group records.
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
- `src/renderer/features/home/Home.tsx` / tests only if needed to turn the existing no-Circle copy/action into navigation to `/circles`; do not expand Home scope.

### Architecture/docs/CI

- `scripts/verify-boundaries.mjs` — forbid shared identities/secrets/legacy paths in public Circle surfaces.
- `.github/workflows/desktop-shell-ci.yml` — include `feature/circles-create-invite` in push branches so every implementation commit gets the full gate.
- `README.md` — document Create/Invite boundary and fixed-role behavior.

---

### Task 1: Safe public Circle contracts and local viewer preference

**Files:**
- Create: `src/main/circle/circleModels.ts`
- Modify: `src/shared/desktopApi.ts`
- Modify: `src/main/database/migrations.ts`
- Modify: `src/main/database/migrations.test.ts`
- Modify: `src/main/auth/UserRepository.ts`
- Modify: `src/main/auth/UserRepository.test.ts`
- Modify: `.github/workflows/desktop-shell-ci.yml`

**Interfaces:**
- Produces public fixed role type `InvitationFamilyRole` and `INVITATION_FAMILY_ROLES`.
- Produces public `CircleListItem`, `CreateCircleInput`, `CreateCircleResult`, `InviteMemberInput`, `InviteMemberResult`.
- Produces internal `CircleGroupInternal`, `CircleTreeInternal`, `CircleTreePersonInternal` containing shared IDs only inside main process.
- Produces `UserRecord.activeCircleId`, `UserRepository.setServerUserId(userId, serverUserId)`, and `UserRepository.setActiveCircleId(userId, circleId)`.

- [ ] **Step 1: Write failing migration/repository tests**

Add assertions equivalent to:

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

and in `UserRepository.test.ts`:

```ts
await users.setServerUserId(user.id, '88')
await users.setActiveCircleId(user.id, 'circle-a')
const record = await users.getRecordById(user.id)
expect(record?.serverUserId).toBe('88')
expect(record?.activeCircleId).toBe('circle-a')
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npx vitest run src/main/database/migrations.test.ts src/main/auth/UserRepository.test.ts
```

Expected: FAIL because `active_circle_id`, `activeCircleId`, `setServerUserId`, and `setActiveCircleId` do not exist.

- [ ] **Step 3: Add shared safe contracts and internal models**

In `src/shared/desktopApi.ts`, define the role allow-list and safe public DTOs:

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

Make renderer-facing records safe by removing shared identities:

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

Create `src/main/circle/circleModels.ts` with internal-only shapes:

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

Add exact repository operations:

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

- [ ] **Step 5: Enable branch CI and run targeted tests/typecheck**

Add `feature/circles-create-invite` under workflow `push.branches`, then run:

```bash
npx vitest run src/main/database/migrations.test.ts src/main/auth/UserRepository.test.ts
npm run typecheck
```

Expected: migration/repository tests PASS; typecheck may reveal the deliberate public/internal ID split in `CircleService`/adapter and should be fixed only in Tasks 2–3, not by re-exposing IDs in `desktopApi.ts`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/desktop-shell-ci.yml src/shared/desktopApi.ts src/main/circle/circleModels.ts src/main/database/migrations.ts src/main/database/migrations.test.ts src/main/auth/UserRepository.ts src/main/auth/UserRepository.test.ts
git commit -m "feat: add safe circle contracts and viewer preference"
```

---

### Task 2: Legacy adapter write compatibility

**Files:**
- Modify: `src/main/circle/LegacyCircleAuthAdapter.ts`
- Modify: `src/main/circle/LegacyCircleAuthAdapter.test.ts`
- Modify: `src/main/circle/LegacyCircleReadAdapter.test.ts`

**Interfaces:**
- Consumes internal types from `circleModels.ts`.
- Produces:

```ts
ensureSharedUser(input: { email: string; name: string }): Promise<{ serverUserId: string }>
createCircle(input: { serverUserId: string; name: string }): Promise<CircleGroupInternal>
inviteMember(input: { serverUserId: string; circleId: string; email: string; role: InvitationFamilyRole }): Promise<InviteMemberResult>
```

- [ ] **Step 1: Write failing adapter tests**

Cover exact request bodies and safe normalization:

```ts
await adapter.ensureSharedUser({ email: 'owner@example.test', name: 'Owner Name' })
expect(fetcher).toHaveBeenCalledWith(
  expect.stringContaining('/api/register'),
  expect.objectContaining({ body: JSON.stringify({ email: 'owner@example.test', name: 'Owner Name' }) }),
)
```

```ts
const created = await adapter.createCircle({ serverUserId: '88', name: 'Kasule Family' })
expect(created).toEqual({ id: 'circle-1', name: 'Kasule Family', ownerId: '88', role: 'Circle owner' })
```

Invite cases must include `sent`, `already-pending`, `already-member`, and `delivery-failed`; include a mocked response containing `token` and `tempPassword` and assert the returned value is exactly `{ outcome: 'sent' }`.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/circle/LegacyCircleAuthAdapter.test.ts src/main/circle/LegacyCircleReadAdapter.test.ts
```

Expected: FAIL because write methods/internal type imports do not exist.

- [ ] **Step 3: Move legacy read normalization onto internal models**

`listGroups()` returns `CircleGroupInternal[]`; `getTree()` returns `CircleTreeInternal`. Keep `ownerId`/`userId` there because `CircleService` needs them for authorization/viewer matching, but do not import renderer-facing safe DTOs for these methods.

- [ ] **Step 4: Implement shared registration and Circle create**

Use existing `postJson()` only:

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

`createCircle()` posts `{ fromUserId: serverUserId, name }` to `/api/group/create` and normalizes the returned group to owner role.

- [ ] **Step 5: Implement invite normalization without leaking credentials**

Post exactly:

```ts
{
  fromUserId: input.serverUserId,
  groupId: input.circleId,
  email: normalizeEmail(input.email),
  role: input.role,
}
```

Normalize response precedence:

```ts
if (data.alreadyMember) return { outcome: 'already-member' }
if (data.emailSent === false) return { outcome: 'delivery-failed' }
if (data.alreadyPending) return { outcome: 'already-pending' }
return { outcome: 'sent' }
```

Never return `data.invitation`, `token`, `tempPassword`, or `emailPayload`.

- [ ] **Step 6: Run adapter tests and typecheck**

```bash
npx vitest run src/main/circle/LegacyCircleAuthAdapter.test.ts src/main/circle/LegacyCircleReadAdapter.test.ts
npm run typecheck
```

Expected: adapter tests PASS. Remaining type failures, if any, should point at `CircleService` still expecting renderer-facing types and are resolved in Task 3.

- [ ] **Step 7: Commit**

```bash
git add src/main/circle/LegacyCircleAuthAdapter.ts src/main/circle/LegacyCircleAuthAdapter.test.ts src/main/circle/LegacyCircleReadAdapter.test.ts
git commit -m "feat: add legacy circle mutation adapter"
```

---

### Task 3: Session-scoped CircleService mutations, selection, and accurate list summaries

**Files:**
- Modify: `src/main/circle/CircleService.ts`
- Modify: `src/main/circle/CircleService.test.ts`

**Interfaces:**
- Consumes `CircleGroupInternal`, `CircleTreeInternal`, repository setters, and adapter write methods.
- Produces:

```ts
getOverview(): Promise<CircleOverview>
getMyCircles(): Promise<CircleListItem[]>
selectCircle(circleId: string): Promise<{ success: true }>
createCircle(input: CreateCircleInput): Promise<CreateCircleResult>
inviteMember(input: InviteMemberInput): Promise<InviteMemberResult>
```

- [ ] **Step 1: Write failing service tests for identity-safe writes**

Include these cases:

```ts
await expect(service.createCircle({ name: 'Kasule Family' }))
  .rejects.toThrow('Please sign in')
```

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

Add a failure case where `ensureSharedUser` succeeds and `createCircle` rejects; assert `setServerUserId(7, '88')` still happened and no rollback setter was called.

- [ ] **Step 2: Write failing selection/list/permission tests**

Accurate multi-Circle count:

```ts
const items = await service.getMyCircles()
expect(items).toEqual([
  { id: 'circle-a', name: 'A Family', role: 'Circle owner', memberCount: 3, isActive: true },
  { id: 'circle-b', name: 'B Family', role: 'Sibling', memberCount: 8, isActive: false },
])
```

Ensure each Circle's tree is read with the protected `serverUserId`.

Selection test: selecting `circle-b` persists only after membership list confirms it. Selecting `not-mine` rejects and does not call `setActiveCircleId`.

Invite test: owner group succeeds; non-owner group rejects before adapter invite. Unknown runtime role such as `'Administrator'` is rejected even if cast through TypeScript.

- [ ] **Step 3: Run RED**

```bash
npx vitest run src/main/circle/CircleService.test.ts
```

Expected: FAIL because the new methods and internal/safe mapping do not exist.

- [ ] **Step 4: Add one protected-context helper**

Keep identity derivation in one private helper:

```ts
private async requireCurrentRecord(): Promise<UserRecord> {
  const current = await this.sessions.restore()
  if (!current) throw new Error('Please sign in to manage your family circles')
  const record = await this.users.getRecordById(current.id)
  if (!record) throw new Error('Please sign in again to manage your family circles')
  return record
}
```

Do not add any service method parameter for acting user/server user.

- [ ] **Step 5: Sanitize internal read data into public DTOs**

`getOverview()` chooses active Circle in this order:

```ts
const activeCircle = circles.find((item) => item.id === record.activeCircleId)
  ?? circles.find((item) => item.id === record.invitation?.groupId)
  ?? circles[0]
```

If the persisted preference is stale, persist the fallback active ID. If no Circles remain, clear a stale `activeCircleId`.

Compute `viewerPersonId` while `userId` is still internal:

```ts
const viewerPersonId = tree.people.find((person) => person.userId === serverUserId)?.id ?? null
```

Then construct a safe `CircleOverview` by stripping `ownerId` from groups/tree group and `userId` from people.

- [ ] **Step 6: Implement accurate `getMyCircles()` and `selectCircle()`**

Use `Promise.all` over the user's group list to read each tree and count confirmed users:

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

`selectCircle(circleId)` must verify the ID exists in `listGroups(serverUserId)` before `setActiveCircleId`.

- [ ] **Step 7: Implement Create Circle and Invite Member**

Create validation:

```ts
const name = String(input.name ?? '').trim()
if (!name) throw new Error('Circle name is required')
if (name.length > 120) throw new Error('Circle name is too long')
```

If no `serverUserId`, call `ensureSharedUser`, persist it immediately, then create. Persist the new Circle ID as active only after create succeeds.

Invite validation:

```ts
if (!INVITATION_FAMILY_ROLES.includes(input.role)) throw new Error('Choose a valid family role')
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new Error('Enter a valid email address')
```

Before adapter invite, load groups and require `group.ownerId === serverUserId` for `input.circleId`; otherwise throw `Only the Circle owner can invite members`.

- [ ] **Step 8: Run service suite + typecheck**

```bash
npx vitest run src/main/circle/CircleService.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main/circle/CircleService.ts src/main/circle/CircleService.test.ts
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
- Modify: `src/main/main.ts` only if composition type errors require no behavioral change.

**Interfaces:**
- Public channels:
  - `circle:get-overview`
  - `circle:get-my-circles`
  - `circle:select`
  - `circle:create`
  - `circle:invite-member`

- [ ] **Step 1: Write failing IPC tests**

Assert exact registered handlers and business-only payload forwarding:

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
```

No handler accepts a second acting-identity argument.

- [ ] **Step 2: Write failing preload tests**

Expect calls exactly:

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

- [ ] **Step 4: Extend `DesktopApi.circle` and channel union**

Use exactly:

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

Handlers call only `CircleService` methods. Do not normalize identities or legacy payloads in IPC/preload.

- [ ] **Step 6: Run IPC/preload tests + typecheck**

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

- [ ] **Step 1: Write failing DesktopCircleClient tests**

`getMyCircles()` must call `window.familyCircle.circle.getMyCircles()` instead of deriving non-active counts from one overview tree.

```ts
await client.getMyCircles()
expect(getMyCircles).toHaveBeenCalledOnce()
```

Selection/create tests should prove the next `getHomeSnapshot()` performs a fresh `getOverview()` after mutation:

```ts
await client.createCircle({ name: 'Kasule Family' })
await client.getHomeSnapshot()
expect(getOverview).toHaveBeenCalledTimes(2)
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/renderer/services/circle/DesktopCircleClient.test.ts src/renderer/services/circle/MockCircleClient.test.ts
```

Expected: FAIL due missing client methods/new list source.

- [ ] **Step 3: Implement public calls and one invalidation helper**

Add:

```ts
private invalidateOverview(): void {
  this.overviewInFlight = null
}
```

After `selectCircle` and successful `createCircle`, invalidate overview. After `inviteMember`, invalidate overview for `sent`, `already-pending`, and `delivery-failed` because shared invitation state exists; `already-member` may also invalidate safely for consistency.

`getMyCircles()` maps already-safe `CircleListItem[]` to renderer `CircleSummary[]` without inventing counts.

- [ ] **Step 4: Keep MockCircleClient test-only compatible**

Implement deterministic fixture methods for interface compliance. Do not import MockCircleClient into production `services.tsx`.

- [ ] **Step 5: Run service tests + typecheck**

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
- Modify: `src/renderer/features/home/Home.tsx` and test only for the no-Circle navigation action if required.

**Interfaces:**
- Consumes `CircleClient.getMyCircles()` and `CircleClient.selectCircle()`.
- Produces `/circles` route, real cards, empty/loading/error state, Open Circle navigation.

- [ ] **Step 1: Write failing page tests**

Cover loading → list, exact member counts, owner/non-owner actions, and empty state:

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

- [ ] **Step 3: Implement real route and states**

Remove `/circles` from `placeholderRoutes` and add:

```tsx
<Route path="/circles" element={<MyCircles />} />
```

`MyCircles` loads via `useAppServices().circle.getMyCircles()` in an effect with an unmounted guard; render a calm loading state and an inline retry on error.

Owner action is based only on `circle.role === 'Circle owner'` from main-process-normalized data.

- [ ] **Step 4: Implement Open Circle**

On button click disable that action while `selectCircle` is in flight, await success, then `navigate('/')`. On failure stay on My Circles and show a safe inline message.

- [ ] **Step 5: Style using existing brand tokens**

Use CSS variables from `tokens.css`; no new palette constants. Cards must fit the current desktop shell at minimum width 1180px and remain usable in the content region.

- [ ] **Step 6: Run page/app tests**

```bash
npx vitest run src/renderer/features/circles/MyCircles.test.tsx src/renderer/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/features/circles/MyCircles.tsx src/renderer/features/circles/MyCircles.test.tsx src/renderer/features/circles/MyCircles.css src/renderer/app/App.tsx src/renderer/app/App.test.tsx src/renderer/features/home/Home.tsx src/renderer/features/home/Home.test.tsx
git commit -m "feat: add real my circles page"
```

---

### Task 7: Create Circle dialog and shared-identity bootstrap UX

**Files:**
- Create: `src/renderer/features/circles/CreateCircleDialog.tsx`
- Create: `src/renderer/features/circles/CreateCircleDialog.test.tsx`
- Modify: `src/renderer/features/circles/MyCircles.tsx`
- Modify: `src/renderer/features/circles/MyCircles.test.tsx`
- Modify: `src/renderer/features/circles/MyCircles.css`

**Interfaces:**
- Consumes `CircleClient.createCircle({ name })`.
- On success closes dialog and reloads `getMyCircles()`; main service already made the new Circle active.

- [ ] **Step 1: Write failing dialog tests**

Required validation and duplicate-submit behavior:

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

With a deferred promise, double click Submit and assert `createCircle` called once and button disabled.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/renderer/features/circles/CreateCircleDialog.test.tsx src/renderer/features/circles/MyCircles.test.tsx
```

Expected: FAIL because dialog does not exist.

- [ ] **Step 3: Implement controlled dialog**

Props:

```ts
interface CreateCircleDialogProps {
  open: boolean
  onClose(): void
  onCreated(circleId: string): Promise<void> | void
}
```

The dialog obtains `circle` from `useAppServices()`, trims locally, validates required/max 120, and calls only `{ name }`.

- [ ] **Step 4: Map safe errors without erasing input**

Known main-service messages map to exact copy:

```ts
'Circle name is required' -> 'Circle name is required.'
'Circle name is too long' -> 'Circle name is too long.'
otherwise -> "We couldn't create the Circle. Please try again."
```

Do not show raw stack/network text.

- [ ] **Step 5: Wire page refresh**

Both `+ Create Circle` and empty-state `Create your first Circle` open the same dialog. After success, close and reload Circle cards from authoritative service data.

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/renderer/features/circles/CreateCircleDialog.test.tsx src/renderer/features/circles/MyCircles.test.tsx
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
- Only owner cards can open the dialog; main process independently re-verifies ownership.

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

Email validation must reject `bad-email` without calling service.

- [ ] **Step 2: Write failing outcome tests**

Parameterize exact UI messages:

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

Props:

```ts
interface InviteMemberDialogProps {
  circle: { id: string; name: string }
  open: boolean
  onClose(): void
  onInvitationChanged(): Promise<void> | void
}
```

Default role is `Family member`. Validate email locally, disable duplicate submit, and call `circle.inviteMember()`.

- [ ] **Step 5: Render normalized outcomes only**

Never inspect or render token/temp-password fields. On `sent`, `already-pending`, and `delivery-failed`, invoke `onInvitationChanged()` so authoritative Circle state can refresh. `already-member` may refresh too; do not fabricate local membership.

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/renderer/features/circles/InviteMemberDialog.test.tsx src/renderer/features/circles/MyCircles.test.tsx
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
- Produces enforcement preventing regression of the approved architecture.

- [ ] **Step 1: Add failing boundary checks**

Extend verifier rules so it rejects:

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

Use existing verifier path-scoping style so tests/fixtures can mention forbidden strings only where explicitly allowed by the verifier itself.

- [ ] **Step 2: Run verifier RED if any current violation remains**

```bash
npm run verify:boundaries
```

Expected before cleanup: FAIL if any old public DTO/import still exposes shared identity; otherwise PASS after Tasks 1–8 have already removed them. Do not weaken rules to obtain green.

- [ ] **Step 3: Update README**

Document:

```text
React My Circles
  -> DesktopCircleClient
  -> typed preload
  -> CircleService (protected session + local viewer preference)
  -> LegacyCircleAuthAdapter
  -> Jose current Circle API
```

State that Create Circle can bootstrap missing shared identity transparently, invitation roles are fixed descriptive labels, and Circle ownership remains separate authorization.

- [ ] **Step 4: Run targeted full feature tests**

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
Vitest: all test files/tests PASS
Boundary verifier: PASS
Electron build: PASS
Vite renderer build: PASS
```

Also require the GitHub Actions run for the exact final commit SHA on `feature/circles-create-invite` to conclude `success` before presenting the branch as merge-ready.

- [ ] **Step 6: Review final diff for security-sensitive leakage**

Inspect changed files and confirm:

```text
No renderer-provided acting identity
No shared owner/user IDs in public Circle DTOs
No token/temp password crossing desktop API
No legacy URL/header outside adapter
No optimistic fabricated counts or successful writes
No Circle owner in invite dropdown
No unrelated rename/delete/leave/remove/tree-edit mutation scope
```

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-boundaries.mjs README.md
git commit -m "docs: secure circle management boundaries"
```

- [ ] **Step 8: Prepare PR, do not merge without user instruction**

Create a PR from `feature/circles-create-invite` to `main` pinned to the verified final head. Include the exact test count, build status, audit result, boundary file counts, and explicitly note excluded management operations. Stop before merge until the user asks to merge.
