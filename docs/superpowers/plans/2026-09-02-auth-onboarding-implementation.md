# Family Circle Auth and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Kin-Keepers Family Circle desktop front door: protected persistent sessions, sign in, registration, invitation claim, password recovery, onboarding, sign out, and clean compatibility with Jose's current Circle service.

**Architecture:** React remains presentation-only and talks through a narrow typed preload API. Electron main owns SQLite identity state, bcrypt-compatible password handling, protected session persistence through `safeStorage`, recovery rules, and the one quarantined legacy Circle adapter. The renderer never receives a raw session credential, Circle API key, raw Circle URL, password hash, or database access.

**Tech Stack:** Electron 44.1.1 / bundled Node 24.19.0, TypeScript 7, React 19, React Router 7, Vitest, Testing Library, built-in `node:sqlite`, `bcryptjs`, `nodemailer`, Electron `safeStorage`.

**Spec:** `docs/superpowers/specs/2026-09-02-auth-onboarding-design.md`

## Global Constraints

- Windows desktop remains the first-class runtime.
- Keep Electron `44.1.1`; do not introduce Tauri or another desktop runtime.
- Use built-in `node:sqlite`; do not add `better-sqlite3` or another native SQLite package.
- Passwords must be 12-72 characters.
- New passwords must be bcrypt-compatible and existing bcrypt hashes must remain verifiable.
- Persistent local sessions expire after 30 days.
- Renderer must never receive a raw session credential, Circle API key, password hash, raw database handle, or direct Circle endpoint URL.
- Do not store auth state in renderer `localStorage` or `sessionStorage`.
- The legacy Circle key is compatibility gating only; it is not user authentication.
- Only `LegacyCircleAuthAdapter` may know the current Circle auth/onboarding endpoint paths or `X-Kin-Keepers-Key` header.
- Use `CIRCLE_API_URL` and `CIRCLE_API_KEY` in the new code; do not add new `P2P_*` configuration.
- Do not bundle SMTP or Circle secrets into renderer assets or a public `.env` file.
- Password reset/change invalidates existing sessions by incrementing `sessionVersion`.
- The authenticated desktop shell must not render before session restoration resolves.
- Preserve Create Circle vs Explore First onboarding choice.
- Preserve the existing neutral recovery response: `If an account exists for that email, a recovery code has been sent.`
- Keep files focused; no new giant IPC or model file.

---

## File Map

### Shared contracts

- Modify `src/shared/desktopApi.ts` — renderer-safe auth/onboarding DTOs and typed preload capability surface.

### Electron main

- Create `src/main/database/database.ts` — `node:sqlite` database creation, pragmas, and transaction helper.
- Create `src/main/database/migrations.ts` — `users` and `password_reset_tokens` schema.
- Create `src/main/auth/passwordPolicy.ts` — email normalization and password-length rule.
- Create `src/main/auth/UserRepository.ts` — local identity persistence, bcrypt-compatible verification, profile/onboarding/session-version updates.
- Create `src/main/auth/SessionStore.ts` — encrypted 30-day local session envelope.
- Create `src/main/auth/PasswordRecoveryService.ts` — hashed recovery codes, expiry, throttling, attempt limits, password replacement.
- Create `src/main/auth/RecoveryMailer.ts` — mailer interface plus legacy SMTP implementation.
- Create `src/main/circle/LegacyCircleAuthAdapter.ts` — all current Circle invite/claim/membership compatibility traffic.
- Create `src/main/auth/AuthService.ts` — orchestration for restore/sign-in/register/sign-out/onboarding.
- Create `src/main/auth/authIpc.ts` — narrow IPC registration only.
- Modify `src/main/main.ts` — compose database/services and register auth IPC.

### Preload

- Modify `src/preload/createDesktopApi.ts` — typed auth/onboarding IPC methods.
- Modify `src/shared/desktopApi.ts` — exact shared method signatures.

### Renderer

- Create `src/renderer/services/auth/AuthClient.ts` — renderer-facing interface.
- Create `src/renderer/services/auth/DesktopAuthClient.ts` — adapter over `window.desktop`.
- Create `src/renderer/services/auth/types.ts` — re-export renderer-safe domain types where useful.
- Create `src/renderer/app/SessionGate.tsx` — restoring/auth/onboarding/app state gate.
- Create `src/renderer/features/auth/AuthScreen.tsx` — single branded front-door container.
- Create `src/renderer/features/auth/SignInForm.tsx` — sign-in form.
- Create `src/renderer/features/auth/RegisterFlow.tsx` — three-step registration and invitation detection.
- Create `src/renderer/features/auth/RecoveryFlow.tsx` — three-step recovery UI.
- Create `src/renderer/features/auth/Auth.css` — auth/front-door styling.
- Create `src/renderer/features/onboarding/Onboarding.tsx` — guided onboarding coordinator.
- Create `src/renderer/features/onboarding/PasswordStep.tsx` — temporary-password replacement.
- Create `src/renderer/features/onboarding/ProfileStep.tsx` — family-visible name.
- Create `src/renderer/features/onboarding/CircleStep.tsx` — invited-circle confirmation or owner choice.
- Create `src/renderer/features/onboarding/ReadyStep.tsx` — completion state.
- Create `src/renderer/features/onboarding/Onboarding.css` — onboarding styling.
- Modify `src/renderer/app/App.tsx` — export authenticated shell separately so `SessionGate` controls whether it renders.
- Modify `src/renderer/main.tsx` — mount `SessionGate` around the app services/router.

### Verification and docs

- Modify `scripts/verify-boundaries.mjs` — reject token storage, direct auth networking, legacy header/URL leakage outside the legacy adapter.
- Modify `README.md` — auth architecture, dev-only compatibility env, recovery mail caveat, verification commands.
- Modify `package.json` / `package-lock.json` — add only `bcryptjs`, `nodemailer`, and Nodemailer typings if required.

---

### Task 1: Shared Auth Contracts and Password Policy

**Files:**
- Modify: `src/shared/desktopApi.ts`
- Create: `src/main/auth/passwordPolicy.ts`
- Test: `src/main/auth/passwordPolicy.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces `AuthUser`, `AuthState`, `InvitationCheckResult`, `CircleContext`, `OnboardingNextAction`, `RegisterInput`, `SignInInput`, `ResetPasswordInput`, and expanded `DesktopApi`.
- Produces `normalizeEmail(email: string): string` and `assertValidPassword(password: string): void`.

- [ ] **Step 1: Add pure-JS bcrypt and mail dependencies**

Run:

```bash
npm install bcryptjs nodemailer
npm install -D @types/nodemailer
```

Expected: `package.json` and `package-lock.json` update without adding `better-sqlite3`, `bcrypt`, or other native modules.

- [ ] **Step 2: Write failing password-policy tests**

Create `src/main/auth/passwordPolicy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertValidPassword, normalizeEmail } from './passwordPolicy'

describe('passwordPolicy', () => {
  it('normalizes email', () => {
    expect(normalizeEmail('  Trevor@Example.COM ')).toBe('trevor@example.com')
  })

  it('accepts passwords from 12 through 72 characters', () => {
    expect(() => assertValidPassword('a'.repeat(12))).not.toThrow()
    expect(() => assertValidPassword('a'.repeat(72))).not.toThrow()
  })

  it('rejects passwords outside the supported bcrypt-safe length', () => {
    expect(() => assertValidPassword('a'.repeat(11))).toThrow('12 and 72')
    expect(() => assertValidPassword('a'.repeat(73))).toThrow('12 and 72')
  })
})
```

- [ ] **Step 3: Run the policy test and confirm RED**

Run:

```bash
npx vitest run src/main/auth/passwordPolicy.test.ts
```

Expected: FAIL because `passwordPolicy.ts` does not exist.

- [ ] **Step 4: Implement the minimum password policy**

Create `src/main/auth/passwordPolicy.ts`:

```ts
export function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase()
}

export function assertValidPassword(password: string): void {
  const length = String(password ?? '').length
  if (length < 12 || length > 72) {
    throw new Error('Password must be between 12 and 72 characters')
  }
}
```

- [ ] **Step 5: Define renderer-safe shared auth types**

Expand `src/shared/desktopApi.ts` with these exact shapes:

```ts
export type AccountOrigin = 'registered' | 'invited' | 'existing'
export type OnboardingNextAction = 'create-circle' | 'home' | 'joined-circle'

export interface AuthUser {
  id: number
  email: string
  name: string | null
  accountOrigin: AccountOrigin
  mustChangePassword: boolean
  onboardingCompleted: boolean
}

export type AuthState =
  | { status: 'unauthenticated' }
  | { status: 'onboarding'; user: AuthUser }
  | { status: 'authenticated'; user: AuthUser }

export interface SignInInput { email: string; password: string }
export interface RegisterInput { name: string; email: string; password: string }
export interface ResetPasswordInput { email: string; code: string; newPassword: string }

export interface InvitationCheckResult {
  hasPendingInvite: boolean
  groupName: string | null
  role: string | null
}

export interface CircleContext {
  accountOrigin: AccountOrigin
  invitation: null | { groupId: string; groupName: string; role: string }
  groups: Array<{ id: string; name: string; role: string }>
}

export interface DesktopApi {
  app: {
    getVersion(): Promise<string>
    getPlatform(): Promise<NodeJS.Platform>
  }
  auth: {
    restore(): Promise<AuthState>
    signIn(input: SignInInput): Promise<AuthState>
    checkInvitation(email: string): Promise<InvitationCheckResult>
    register(input: RegisterInput): Promise<AuthState>
    signOut(): Promise<{ success: true }>
    requestPasswordReset(email: string): Promise<{ success: true; message: string; expiresInMinutes: number }>
    resetPassword(input: ResetPasswordInput): Promise<{ success: true }>
  }
  onboarding: {
    getState(): Promise<AuthState>
    setInitialPassword(newPassword: string): Promise<AuthState>
    updateProfile(name: string): Promise<AuthState>
    getCircleContext(): Promise<CircleContext>
    complete(nextAction: OnboardingNextAction): Promise<AuthState>
  }
}
```

- [ ] **Step 6: Run policy and type checks**

Run:

```bash
npm run typecheck
npx vitest run src/main/auth/passwordPolicy.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add package.json package-lock.json src/shared/desktopApi.ts src/main/auth/passwordPolicy.ts src/main/auth/passwordPolicy.test.ts
git commit -m "feat: define auth contracts and password policy"
```

---

### Task 2: Built-in SQLite Database and User Repository

**Files:**
- Create: `src/main/database/database.ts`
- Create: `src/main/database/migrations.ts`
- Create: `src/main/auth/UserRepository.ts`
- Test: `src/main/auth/UserRepository.test.ts`

**Interfaces:**
- Consumes `AccountOrigin`, `AuthUser`, `normalizeEmail`, `assertValidPassword` from Task 1.
- Produces `openDatabase(path: string): DatabaseSync`, `runMigrations(db: DatabaseSync): void`, and `UserRepository` methods used by Tasks 3-6.

- [ ] **Step 1: Write failing repository tests using `:memory:` SQLite**

Create `src/main/auth/UserRepository.test.ts` covering exact behavior:

```ts
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../database/migrations'
import { UserRepository } from './UserRepository'

describe('UserRepository', () => {
  let db: DatabaseSync
  let users: UserRepository

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    runMigrations(db)
    users = new UserRepository(db)
  })

  it('creates a registered user atomically with normalized email and name', async () => {
    const user = await users.createRegisteredUser({
      name: 'Trevor',
      email: ' TREVOR@example.com ',
      password: 'correct horse battery',
    })
    expect(user.email).toBe('trevor@example.com')
    expect(user.name).toBe('Trevor')
    expect(user.accountOrigin).toBe('registered')
    expect(user.onboardingCompleted).toBe(false)
    expect(await users.verifyPassword(user.id, 'correct horse battery')).toBe(true)
  })

  it('rejects duplicate normalized email', async () => {
    await users.createRegisteredUser({ name: 'A', email: 'a@example.com', password: '123456789012' })
    await expect(users.createRegisteredUser({ name: 'B', email: ' A@EXAMPLE.COM ', password: '123456789012' }))
      .rejects.toThrow('already registered')
  })

  it('creates invited user with onboarding flags and invitation metadata', async () => {
    const user = await users.createInvitedUser({
      email: 'invite@example.com',
      name: 'Invitee',
      password: 'temporary-pass-123',
      serverUserId: '44',
      invitation: { groupId: '9', groupName: 'Kasule Family', role: 'Family member' },
    })
    expect(user.accountOrigin).toBe('invited')
    expect(user.mustChangePassword).toBe(true)
    expect(user.onboardingCompleted).toBe(false)
  })

  it('increments sessionVersion when replacing a password', async () => {
    const user = await users.createRegisteredUser({ name: 'A', email: 'a@example.com', password: '123456789012' })
    const before = await users.getSessionVersion(user.id)
    await users.replacePassword(user.id, 'abcdefghijkl')
    expect(await users.getSessionVersion(user.id)).toBe(before + 1)
  })
})
```

- [ ] **Step 2: Run repository test and confirm RED**

Run:

```bash
npx vitest run src/main/auth/UserRepository.test.ts
```

Expected: FAIL because database/repository modules do not exist.

- [ ] **Step 3: Implement database creation and transaction helper**

Create `src/main/database/database.ts`:

```ts
import { DatabaseSync } from 'node:sqlite'

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
  return db
}

export function withTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = work()
    db.exec('COMMIT')
    return value
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
```

- [ ] **Step 4: Implement schema migrations**

Create `src/main/database/migrations.ts` with schema equivalent to:

```ts
import type { DatabaseSync } from 'node:sqlite'

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT,
      server_user_id TEXT,
      session_version INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      account_origin TEXT NOT NULL CHECK (account_origin IN ('registered','invited','existing')),
      invitation_group_id TEXT,
      invitation_group_name TEXT,
      invitation_role TEXT,
      claimed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_password_reset_user_created
      ON password_reset_tokens(user_id, created_at DESC);
  `)
}
```

- [ ] **Step 5: Implement `UserRepository` using `bcryptjs`**

Implement these exact methods in `src/main/auth/UserRepository.ts`:

```ts
findByEmail(email: string): Promise<AuthUser | null>
findRecordByEmail(email: string): Promise<UserRecord | null>
findById(id: number): Promise<AuthUser | null>
createRegisteredUser(input: RegisterInput): Promise<AuthUser>
createInvitedUser(input: CreateInvitedUserInput): Promise<AuthUser>
verifyPassword(userId: number, password: string): Promise<boolean>
replacePassword(userId: number, password: string): Promise<AuthUser>
updateProfile(userId: number, name: string): Promise<AuthUser>
markOnboardingComplete(userId: number): Promise<AuthUser>
getSessionVersion(userId: number): Promise<number>
```

Use `bcryptjs.hash(password, 12)` for newly written hashes and `bcryptjs.compare(...)` for verification. `bcryptjs.compare` must be used rather than inventing another password format so current bcrypt hashes remain compatible.

Shape rows into renderer-safe `AuthUser` objects and never return `password_hash` outside repository-internal record methods.

- [ ] **Step 6: Run repository tests and typecheck**

Run:

```bash
npx vitest run src/main/auth/UserRepository.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/main/database src/main/auth/UserRepository.ts src/main/auth/UserRepository.test.ts
git commit -m "feat: add local identity repository"
```

---

### Task 3: Protected 30-Day Session Store

**Files:**
- Create: `src/main/auth/SessionStore.ts`
- Test: `src/main/auth/SessionStore.test.ts`

**Interfaces:**
- Consumes `UserRepository.getSessionVersion()` and `findById()`.
- Produces `SessionStore.save(userId)`, `SessionStore.restore()`, and `SessionStore.clear()`.

- [ ] **Step 1: Write failing session-store tests with injected crypto and file storage**

The test must use deterministic fakes rather than Electron `safeStorage`:

```ts
const crypto = {
  isAvailable: () => true,
  encrypt: (value: string) => Buffer.from(`encrypted:${value}`),
  decrypt: (value: Buffer) => value.toString().replace(/^encrypted:/, ''),
}
```

Cover:

```ts
it('restores a valid unexpired session')
it('rejects and deletes an expired session')
it('rejects and deletes a sessionVersion mismatch')
it('rejects corrupt encrypted payload')
it('clear removes the persisted session')
```

Use a fake clock so `expiresAt` is deterministic.

- [ ] **Step 2: Run session tests and confirm RED**

```bash
npx vitest run src/main/auth/SessionStore.test.ts
```

Expected: FAIL because `SessionStore.ts` does not exist.

- [ ] **Step 3: Implement injectable session storage**

Use these interfaces:

```ts
export interface ProtectedCrypto {
  isAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

export interface SessionFile {
  read(): Promise<Buffer | null>
  write(value: Buffer): Promise<void>
  remove(): Promise<void>
}

interface SessionEnvelope {
  userId: number
  sessionVersion: number
  expiresAt: number
}
```

`SessionStore.save(userId)` must:

1. read current `sessionVersion`
2. set `expiresAt = now + 30 * 24 * 60 * 60 * 1000`
3. JSON encode
4. encrypt
5. persist encrypted bytes

`restore()` must delete and return `null` when expired, corrupt, missing user, or sessionVersion mismatched.

- [ ] **Step 4: Add the Electron production adapters**

In the same file export factories that wrap:

```ts
safeStorage.isEncryptionAvailable()
safeStorage.encryptString(value)
safeStorage.decryptString(buffer)
```

and a session file at:

```ts
join(app.getPath('userData'), 'auth-session.bin')
```

Do not implement a plaintext fallback. On Windows, unavailable protected storage should be treated as a setup/runtime error rather than silently persisting plaintext credentials.

- [ ] **Step 5: Run tests/typecheck**

```bash
npx vitest run src/main/auth/SessionStore.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/main/auth/SessionStore.ts src/main/auth/SessionStore.test.ts
git commit -m "feat: add protected persistent sessions"
```

---

### Task 4: Password Recovery Rules and Legacy SMTP Mailer

**Files:**
- Create: `src/main/auth/PasswordRecoveryService.ts`
- Create: `src/main/auth/RecoveryMailer.ts`
- Test: `src/main/auth/PasswordRecoveryService.test.ts`

**Interfaces:**
- Consumes `UserRepository` and password policy.
- Produces `request(email)` and `reset({ email, code, newPassword })`.
- Produces `RecoveryMailer.sendCode(...)` and `RecoveryMailer.sendChangedNotice(...)`.

- [ ] **Step 1: Write failing recovery-service tests**

Use a fake mailer and in-memory SQLite. Cover the exact rules:

```ts
it('returns the same neutral response for unknown and known accounts')
it('stores only sha256 hash of the recovery code')
it('expires codes after 10 minutes')
it('allows no more than 3 requests per rolling hour and no more than one per minute')
it('increments failed attempts and consumes the code at 5 failures')
it('consumes a successful code once')
it('rejects reuse of the previous password')
it('increments sessionVersion after reset')
```

The expected request response is always:

```ts
{
  success: true,
  message: 'If an account exists for that email, a recovery code has been sent.',
  expiresInMinutes: 10,
}
```

- [ ] **Step 2: Run recovery tests and confirm RED**

```bash
npx vitest run src/main/auth/PasswordRecoveryService.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement recovery code lifecycle**

Use:

```ts
const RESET_TTL_MS = 10 * 60 * 1000
const RESET_WINDOW_MS = 60 * 60 * 1000
const RESET_REQUEST_LIMIT = 3
const RESET_ATTEMPT_LIMIT = 5
```

Generate the human code with:

```ts
String(randomInt(0, 100_000_000)).padStart(8, '0')
```

Store only:

```ts
createHash('sha256').update(code).digest('hex')
```

Compare hashes with `timingSafeEqual`.

On successful reset, use one SQLite transaction to:

1. consume the token
2. replace the password hash
3. increment `session_version`
4. invalidate other unused reset tokens for that user

- [ ] **Step 4: Implement the recovery mail interface and compatibility SMTP transport**

Create:

```ts
export interface RecoveryMailer {
  sendCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void>
  sendChangedNotice(input: { to: string }): Promise<void>
}
```

The legacy Nodemailer implementation may read these main-process environment names for compatibility:

```text
SEND_EMAILS
SMTP_HOST or MAIL_HOST
SMTP_PORT or EMAIL_PORT
MAIL_USER or EMAIL_USER
EMAIL_PASS or MAIL_PASS
SMTP_SECURE or EMAIL_SECURE
SMTP_TIMEOUT_MS or EMAIL_TIMEOUT_MS
FROM_EMAIL
```

Require TLS 1.2 minimum. If `SEND_EMAILS` is not `true`, the mailer must be a disabled/no-op compatibility transport while the recovery request still returns the neutral response.

Do not place SMTP credentials in renderer code, Vite env, or committed `.env` files.

- [ ] **Step 5: Run recovery tests/typecheck**

```bash
npx vitest run src/main/auth/PasswordRecoveryService.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/main/auth/PasswordRecoveryService.ts src/main/auth/PasswordRecoveryService.test.ts src/main/auth/RecoveryMailer.ts
git commit -m "feat: add secure password recovery"
```

---

### Task 5: Legacy Circle Auth Compatibility Adapter

**Files:**
- Create: `src/main/circle/LegacyCircleAuthAdapter.ts`
- Test: `src/main/circle/LegacyCircleAuthAdapter.test.ts`

**Interfaces:**
- Produces `checkInvitation(email)`, `claimInvitation(input)`, and `getMemberships(serverUserId)`.
- No other new file may know current Circle auth endpoint paths or `X-Kin-Keepers-Key`.

- [ ] **Step 1: Write failing adapter tests with injected fetch**

Define a fetch-like dependency so no test uses the network. Cover:

```ts
it('checks invitation without exposing temp password or token')
it('adds X-Kin-Keepers-Key only inside the legacy adapter when configured')
it('claims invite by resolving shared user, accepting token, marking claimed, and confirming membership')
it('fails claim when entered temporary password is wrong')
it('fails claim when expected membership cannot be confirmed')
it('times out remote calls')
```

The public invitation check result must contain only:

```ts
{ hasPendingInvite, groupName, role }
```

It must never return `tempPassword` or invite token to the renderer-facing caller.

- [ ] **Step 2: Run adapter tests and confirm RED**

```bash
npx vitest run src/main/circle/LegacyCircleAuthAdapter.test.ts
```

Expected: FAIL because adapter does not exist.

- [ ] **Step 3: Implement runtime configuration**

Constructor input:

```ts
interface LegacyCircleConfig {
  baseUrl: string
  apiKey: string
  timeoutMs?: number
}
```

Production composition reads:

```ts
CIRCLE_API_URL
CIRCLE_API_KEY
```

Do not add `P2P_SERVER` or `P2P_API_KEY` to the new repo.

- [ ] **Step 4: Implement only the compatibility endpoints needed for this slice**

The adapter may internally call the current paths:

```text
GET  /api/invitation-check?email=...
POST /api/register
POST /api/invitations/accept-link
POST /api/user/mark-claimed
GET  /api/me/{serverUserId}/groups
```

`claimInvitation({ email, enteredPassword })` must verify the temporary password in the main process, resolve/confirm the shared user and membership, and return this safe internal result to `AuthService`:

```ts
interface ClaimedInvitation {
  email: string
  name: string
  serverUserId: string
  temporaryPassword: string
  invitation: { groupId: string; groupName: string; role: string }
}
```

This object is main-process internal only and must never be returned through preload.

- [ ] **Step 5: Run adapter tests/typecheck**

```bash
npx vitest run src/main/circle/LegacyCircleAuthAdapter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/main/circle/LegacyCircleAuthAdapter.ts src/main/circle/LegacyCircleAuthAdapter.test.ts
git commit -m "feat: isolate legacy circle auth compatibility"
```

---

### Task 6: Auth Service Orchestration

**Files:**
- Create: `src/main/auth/AuthService.ts`
- Test: `src/main/auth/AuthService.test.ts`

**Interfaces:**
- Consumes `UserRepository`, `SessionStore`, `PasswordRecoveryService`, and `LegacyCircleAuthAdapter`.
- Produces all main-process operations later exposed through IPC.

- [ ] **Step 1: Write failing service tests with fakes**

Cover these exact flows:

```ts
it('restores unauthenticated when no protected session exists')
it('restores authenticated for completed user')
it('restores onboarding for incomplete user')
it('signs in existing local user without calling Circle adapter')
it('rejects wrong password for an existing local user without falling through to invite claim')
it('claims first-time invited user when no local user exists')
it('does not create invited local user when membership confirmation fails')
it('registration stops when invitation exists')
it('registers new owner transactionally and creates onboarding session')
it('sign out clears protected session')
it('setInitialPassword invalidates old session version then stores a new session')
it('updateProfile returns onboarding state')
it('invited onboarding context requires the expected circle')
it('complete onboarding returns authenticated state')
```

- [ ] **Step 2: Run service tests and confirm RED**

```bash
npx vitest run src/main/auth/AuthService.test.ts
```

Expected: FAIL because `AuthService.ts` does not exist.

- [ ] **Step 3: Implement state shaping**

Centralize:

```ts
function stateFor(user: AuthUser): AuthState {
  return user.mustChangePassword || !user.onboardingCompleted
    ? { status: 'onboarding', user }
    : { status: 'authenticated', user }
}
```

- [ ] **Step 4: Implement sign-in flow without local JWT**

Algorithm:

```text
normalize email
 -> local record exists?
    -> yes: verify password; never attempt invite fallback on wrong password
    -> no: claim invitation through LegacyCircleAuthAdapter
          -> after membership confirmed create local invited user
 -> save protected session
 -> return renderer-safe AuthState
```

Do not create or decode JWTs.

- [ ] **Step 5: Implement registration flow**

Algorithm:

```text
validate name/email/password
 -> check invitation
    -> invite exists: return typed domain error INVITATION_EXISTS with safe invitation summary
    -> no invite: create registered user transactionally
 -> save protected session
 -> return onboarding state
```

Use typed errors/codes internally so React can render intentional copy without parsing raw database/network strings.

- [ ] **Step 6: Implement onboarding operations**

`setInitialPassword(newPassword)`:

1. restore current protected user
2. require `mustChangePassword`
3. replace password, incrementing sessionVersion
4. clear `mustChangePassword`
5. save a fresh protected session with the new version
6. return onboarding state

`updateProfile(name)` validates at least 2 trimmed characters and returns updated state.

`getCircleContext()`:

- invited user: confirm memberships and expected invited Circle
- registered/existing user: return account origin and available context without forcing a Circle

`complete(nextAction)`:

- invited: require expected Circle still available, then mark complete
- registered: accept only `create-circle` or `home`
- save fresh session and return authenticated state

- [ ] **Step 7: Wire recovery methods through the service**

`requestPasswordReset(email)` delegates to `PasswordRecoveryService.request`.

`resetPassword(input)` delegates to reset service, clears any currently persisted session, and sends changed notice after success.

- [ ] **Step 8: Run service tests and all main auth tests**

```bash
npx vitest run src/main/auth src/main/circle
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 6**

```bash
git add src/main/auth/AuthService.ts src/main/auth/AuthService.test.ts
git commit -m "feat: orchestrate desktop authentication"
```

---

### Task 7: Narrow Auth IPC and Preload Bridge

**Files:**
- Create: `src/main/auth/authIpc.ts`
- Modify: `src/main/main.ts`
- Modify: `src/preload/createDesktopApi.ts`
- Modify: `src/preload/createDesktopApi.test.ts`
- Test: `src/main/auth/authIpc.test.ts`

**Interfaces:**
- Consumes `AuthService` methods from Task 6.
- Produces the exact `DesktopApi.auth` and `DesktopApi.onboarding` capabilities from Task 1.

- [ ] **Step 1: Expand the preload test first**

Require the returned desktop API to expose only these auth/onboarding functions:

```ts
expect(Object.keys(api.auth)).toEqual([
  'restore',
  'signIn',
  'checkInvitation',
  'register',
  'signOut',
  'requestPasswordReset',
  'resetPassword',
])

expect(Object.keys(api.onboarding)).toEqual([
  'getState',
  'setInitialPassword',
  'updateProfile',
  'getCircleContext',
  'complete',
])
```

Also assert there is no `getToken`, `decodeToken`, `setApiKey`, `rawFetch`, or raw DB capability.

- [ ] **Step 2: Run preload test and confirm RED**

```bash
npx vitest run src/preload/createDesktopApi.test.ts
```

Expected: FAIL because auth/onboarding surface does not yet exist.

- [ ] **Step 3: Implement typed preload channel mapping**

Extend the internal invoke channel union and payload handling for:

```text
auth:restore
auth:sign-in
auth:check-invitation
auth:register
auth:sign-out
auth:request-password-reset
auth:reset-password
onboarding:get-state
onboarding:set-initial-password
onboarding:update-profile
onboarding:get-circle-context
onboarding:complete
```

The preload methods must forward ordinary typed inputs only. No credential is returned from main.

- [ ] **Step 4: Write and implement IPC registration tests**

Use a fake registrar/service so `authIpc.test.ts` proves every channel delegates to the intended service method exactly once and no raw Electron event object enters domain code.

- [ ] **Step 5: Compose services in `main.ts`**

At startup:

```text
open userData/family-circle.db
run migrations
create UserRepository
create SessionStore with safeStorage adapter
create RecoveryMailer
create PasswordRecoveryService
create LegacyCircleAuthAdapter from CIRCLE_API_URL/CIRCLE_API_KEY
create AuthService
register auth IPC
create BrowserWindow
```

Keep `main.ts` composition-focused; do not move business logic into it.

- [ ] **Step 6: Run IPC/preload tests and typecheck**

```bash
npx vitest run src/preload src/main/auth/authIpc.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add src/main/main.ts src/main/auth/authIpc.ts src/main/auth/authIpc.test.ts src/preload/createDesktopApi.ts src/preload/createDesktopApi.test.ts
git commit -m "feat: expose narrow desktop auth bridge"
```

---

### Task 8: Renderer Auth Client and Session Gate

**Files:**
- Create: `src/renderer/services/auth/AuthClient.ts`
- Create: `src/renderer/services/auth/DesktopAuthClient.ts`
- Create: `src/renderer/services/auth/types.ts`
- Create: `src/renderer/app/SessionGate.tsx`
- Test: `src/renderer/app/SessionGate.test.tsx`
- Modify: `src/renderer/app/App.tsx`
- Modify: `src/renderer/main.tsx`

**Interfaces:**
- Consumes `window.desktop.auth` / `window.desktop.onboarding`.
- Produces `AuthClient` for auth/onboarding React features and guards shell rendering.

- [ ] **Step 1: Write failing SessionGate tests**

Cover:

```ts
it('shows branded restoring state before restore resolves')
it('renders auth screen for unauthenticated state')
it('renders onboarding for onboarding state')
it('renders the authenticated shell only for authenticated state')
it('never renders Home before restore resolves')
```

Use a deferred Promise for `restore()` in the first test.

- [ ] **Step 2: Run gate tests and confirm RED**

```bash
npx vitest run src/renderer/app/SessionGate.test.tsx
```

Expected: FAIL because `SessionGate` does not exist.

- [ ] **Step 3: Implement the renderer `AuthClient` abstraction**

`AuthClient` mirrors safe domain operations, not IPC channel names. `DesktopAuthClient` delegates to `window.desktop`.

No `fetch`, URL, environment variable, token, or API key is allowed here.

- [ ] **Step 4: Split authenticated shell from session gate**

Rename the current shell function conceptually to:

```ts
export function AuthenticatedApp() { /* existing sidebar/topbar/routes */ }
```

`SessionGate` owns the top-level state. `main.tsx` renders the gate, not `AuthenticatedApp` directly.

- [ ] **Step 5: Implement branded restoring view**

Use existing `BrandMark` and approved copy:

```text
Family Circle
Opening your private workspace...
```

Do not show endpoint, database, API, token, or retry diagnostics during ordinary restore.

- [ ] **Step 6: Run gate tests/typecheck**

```bash
npx vitest run src/renderer/app/SessionGate.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```bash
git add src/renderer/services/auth src/renderer/app/SessionGate.tsx src/renderer/app/SessionGate.test.tsx src/renderer/app/App.tsx src/renderer/main.tsx
git commit -m "feat: gate desktop shell behind session restore"
```

---

### Task 9: Branded Sign-In, Registration, and Recovery UI

**Files:**
- Create: `src/renderer/features/auth/AuthScreen.tsx`
- Create: `src/renderer/features/auth/SignInForm.tsx`
- Create: `src/renderer/features/auth/RegisterFlow.tsx`
- Create: `src/renderer/features/auth/RecoveryFlow.tsx`
- Create: `src/renderer/features/auth/Auth.css`
- Test: `src/renderer/features/auth/AuthScreen.test.tsx`

**Interfaces:**
- Consumes `AuthClient` from Task 8.
- Produces successful `AuthState` changes back to `SessionGate` via callback, with no renderer-stored credentials.

- [ ] **Step 1: Write failing front-door tests**

Cover:

```ts
it('signs in and emits onboarding state')
it('shows incorrect-password error without leaving form')
it('registers in name -> email -> password steps')
it('checks invitation at registration email step')
it('redirects invitation email to sign-in with email prefilled')
it('validates 12-72 character registration password and confirmation')
it('requests recovery with neutral confirmation copy')
it('submits email + code + new password together for reset')
it('returns to sign in with recovered email prefilled')
```

- [ ] **Step 2: Run auth UI test and confirm RED**

```bash
npx vitest run src/renderer/features/auth/AuthScreen.test.tsx
```

Expected: FAIL because auth components do not exist.

- [ ] **Step 3: Implement one coherent `AuthScreen`**

Modes:

```ts
type AuthMode = 'sign-in' | 'register' | 'recover'
```

Use one branded shell and switch the focused form inside it. Do not create three unrelated page layouts.

- [ ] **Step 4: Implement `SignInForm`**

Fields:

```text
Email
Password + Show/Hide
Sign in
Forgot password?
Create an account
```

Disable submit while in flight and expose an accessible status/error region.

- [ ] **Step 5: Implement `RegisterFlow`**

State:

```ts
type RegisterStep = 'name' | 'email' | 'password'
```

At email step, call `authClient.checkInvitation(email)` before advancing. If invite exists, show group/role when present and return to sign-in with email prefilled.

At password step, require 12-72 chars and matching confirmation. Call `register({ name, email, password })` once.

- [ ] **Step 6: Implement `RecoveryFlow`**

UI states:

```ts
type RecoveryStep = 'email' | 'code' | 'password' | 'complete'
```

The code step is UX-only; it must not call an invented code-verification endpoint. Final reset submits `{ email, code, newPassword }` atomically through the one reset operation.

- [ ] **Step 7: Style with approved Kin-Keepers system**

Use existing design tokens and bundled `kin-cropped.jpg`. Keep the page light/calm with navy text, teal primary action, restrained gold accent, white card, and no promotional carousel.

- [ ] **Step 8: Run auth UI tests/typecheck**

```bash
npx vitest run src/renderer/features/auth
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 9**

```bash
git add src/renderer/features/auth
git commit -m "feat: add branded auth front door"
```

---

### Task 10: Guided Invited and Owner Onboarding UI

**Files:**
- Create: `src/renderer/features/onboarding/Onboarding.tsx`
- Create: `src/renderer/features/onboarding/PasswordStep.tsx`
- Create: `src/renderer/features/onboarding/ProfileStep.tsx`
- Create: `src/renderer/features/onboarding/CircleStep.tsx`
- Create: `src/renderer/features/onboarding/ReadyStep.tsx`
- Create: `src/renderer/features/onboarding/Onboarding.css`
- Test: `src/renderer/features/onboarding/Onboarding.test.tsx`

**Interfaces:**
- Consumes `AuthClient` onboarding methods and safe `AuthUser` state.
- Produces authenticated state back to `SessionGate` after successful completion.

- [ ] **Step 1: Write failing onboarding tests**

Cover:

```ts
it('starts invited must-change-password user at Secure your account')
it('skips password step when mustChangePassword is false')
it('updates family-visible profile name')
it('shows confirmed invited Circle and role')
it('shows retry without losing completed steps when Circle confirmation fails')
it('offers Create a family circle and Explore the app first to registered owners')
it('completes invited user with joined-circle action')
it('completes owner with create-circle action')
it('completes owner with home action')
```

- [ ] **Step 2: Run onboarding tests and confirm RED**

```bash
npx vitest run src/renderer/features/onboarding/Onboarding.test.tsx
```

Expected: FAIL because onboarding components do not exist.

- [ ] **Step 3: Implement onboarding coordinator and progress model**

Progress labels:

```text
Secure your account
Your profile
Your family circle
Ready
```

Skip/complete password step for users that do not require it.

- [ ] **Step 4: Implement password/profile steps**

Password step calls only `setInitialPassword(newPassword)` after local confirmation validation.

Profile step requires a trimmed name of at least 2 characters and calls `updateProfile(name)`.

- [ ] **Step 5: Implement Circle step**

Invited account:

1. call `getCircleContext()`
2. display only confirmed Circle name and role
3. on remote failure, show calm retry copy and preserve earlier local work

Registered owner:

Render two selectable choices:

```text
Create a family circle
Explore the app first
```

No Circle is created in this auth slice; the choice only determines the post-onboarding next action.

- [ ] **Step 6: Implement Ready step and completion**

Invited completion calls:

```ts
complete('joined-circle')
```

Owner completion calls one of:

```ts
complete('create-circle')
complete('home')
```

After success, emit authenticated state to `SessionGate`.

- [ ] **Step 7: Run onboarding tests/typecheck**

```bash
npx vitest run src/renderer/features/onboarding
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 10**

```bash
git add src/renderer/features/onboarding
git commit -m "feat: add guided family circle onboarding"
```

---

### Task 11: Boundary Enforcement, Integration Checks, and Documentation

**Files:**
- Modify: `scripts/verify-boundaries.mjs`
- Modify: `README.md`
- Modify: `.github/workflows/desktop-shell-ci.yml` only if CI needs explicit Node SQLite warning handling; otherwise leave unchanged.
- Test: all test suites.

**Interfaces:**
- Verifies every security/architecture invariant from the spec.
- Produces a branch ready for review/merge.

- [ ] **Step 1: Add boundary rules before final verification**

Extend `scripts/verify-boundaries.mjs` so it fails on renderer occurrences of:

```text
localStorage.*token
sessionStorage.*token
getToken(
decodeToken(
X-Kin-Keepers-Key
CIRCLE_API_KEY
P2P_API_KEY
P2P_SERVER
familycircle.o2gventures.com/circle-api
```

Also scan all `src/main/**/*.ts` files and permit `X-Kin-Keepers-Key` and current endpoint path literals only inside:

```text
src/main/circle/LegacyCircleAuthAdapter.ts
```

A test/source exception may reference forbidden strings only as literal assertions in boundary-verifier tests if such a test file is added; production files may not.

- [ ] **Step 2: Add an auth regression test for renderer credential storage**

Add a small source-boundary test or extend verifier logic to ensure neither auth nor onboarding feature code contains:

```ts
localStorage.setItem(
sessionStorage.setItem(
fetch(
```

This makes the design invariant executable.

- [ ] **Step 3: Update README**

Document:

```text
Auth architecture
- local SQLite identity in Electron main
- bcrypt-compatible hashes
- encrypted 30-day session via safeStorage
- no renderer token
- Jose compatibility isolated in LegacyCircleAuthAdapter

Development compatibility configuration
- CIRCLE_API_URL
- CIRCLE_API_KEY
- SEND_EMAILS and SMTP variables

Security note
- do not commit or package SMTP/Circle credentials in a public .env
- legacy Circle app-wide key is not per-user authentication
- move recovery mail and Circle identity server-side as /v2 work matures
```

- [ ] **Step 4: Run focused auth tests**

```bash
npx vitest run src/main/auth src/main/circle src/preload src/renderer/features/auth src/renderer/features/onboarding src/renderer/app/SessionGate.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run the complete repository gate**

```bash
npm run check
```

Expected:

```text
TypeScript: PASS
Vitest: PASS
Renderer/main boundary verification: PASS
Electron TypeScript build: PASS
Vite production build: PASS
```

- [ ] **Step 6: Audit dependency state**

Run:

```bash
npm audit
```

Expected: no unresolved high/critical vulnerability. If npm reports one, stop before declaring the slice complete and inspect whether it affects runtime dependencies.

- [ ] **Step 7: Commit Task 11**

```bash
git add scripts/verify-boundaries.mjs README.md package.json package-lock.json .github/workflows/desktop-shell-ci.yml
git commit -m "chore: verify auth onboarding boundaries"
```

- [ ] **Step 8: Final branch verification before integration**

Run:

```bash
npm run check
```

Record the exact passing test count and commit SHA in the handoff. Do not claim completion from an earlier run.
