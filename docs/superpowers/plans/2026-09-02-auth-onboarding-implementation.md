# Family Circle Auth and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Kin-Keepers Family Circle desktop front door: protected persistent sessions, sign in, registration, invitation claim, password recovery, onboarding, sign out, and compatibility with Jose's current Circle service and existing local Family Circle accounts.

**Architecture:** React remains presentation-only behind a narrow typed preload API. Electron main owns the local SQLite identity database, bcrypt-compatible passwords, `safeStorage` session persistence, recovery rules, and the one quarantined legacy Circle adapter. On first run, the rebuild copies Jose's existing `Family Circle/family.db` into the rebuild's own user-data directory and migrates the copy, leaving the old application's database untouched.

**Tech Stack:** Electron 44.1.1 / bundled Node 24.19.0, TypeScript 7, React 19, React Router 7, Vitest, Testing Library, built-in `node:sqlite`, `bcryptjs`, `nodemailer`, Electron `safeStorage`.

**Spec:** `docs/superpowers/specs/2026-09-02-auth-onboarding-design.md`

## Global Constraints

- Windows desktop is the first-class runtime.
- Keep Electron `44.1.1`; do not introduce another desktop runtime.
- Use built-in `node:sqlite`; do not add `better-sqlite3` or another native SQLite dependency.
- Preserve old bcrypt hashes; newly written passwords remain bcrypt compatible.
- Password length is 12-72 characters.
- Persistent sessions expire after 30 days.
- Renderer never receives a session credential, password hash, Circle API key, raw Circle URL, or database handle.
- Do not store auth state in renderer `localStorage` or `sessionStorage`.
- Only `LegacyCircleAuthAdapter` may know current Circle auth/onboarding paths or `X-Kin-Keepers-Key`.
- New configuration names are `CIRCLE_API_URL` and `CIRCLE_API_KEY`; do not add new `P2P_*` usage.
- The legacy app-wide Circle key is compatibility gating, not user authentication.
- Never commit/package SMTP or Circle credentials into renderer assets or a public `.env`.
- Password reset or replacement increments `sessionVersion`, invalidating old sessions.
- The authenticated shell must not render before session restoration resolves.
- Preserve invited-vs-registered account origin and Create Circle vs Explore First onboarding behavior.
- Preserve neutral recovery copy: `If an account exists for that email, a recovery code has been sent.`
- Do not modify Jose's original `%APPDATA%/Family Circle/family.db` during migration; copy first, then migrate the copy.
- Keep modules focused; no giant replacement for `ipcMainHandlers.js` or `userModel.js`.

---

## File Map

**Shared/preload**
- Modify `src/shared/desktopApi.ts` — renderer-safe DTOs and capabilities.
- Modify `src/preload/createDesktopApi.ts` and its test — typed IPC bridge.

**Main process**
- Create `src/main/auth/passwordPolicy.ts` — email/password rules.
- Create `src/main/auth/passwordCrypto.ts` — bcryptjs hash/compare helpers.
- Create `src/main/database/database.ts` — path resolution, copy-safe legacy import, `node:sqlite`, transactions.
- Create `src/main/database/migrations.ts` — fresh schema plus additive migration of Jose's copied DB.
- Create `src/main/auth/UserRepository.ts` — local identity persistence and internal/safe shapes.
- Create `src/main/auth/SessionStore.ts` — encrypted 30-day session envelope.
- Create `src/main/auth/RecoveryMailer.ts` — recovery-mail interface + legacy SMTP transport.
- Create `src/main/auth/PasswordRecoveryService.ts` — reset-code lifecycle and atomic reset.
- Create `src/main/circle/LegacyCircleAuthAdapter.ts` — all current shared-service compatibility calls.
- Create `src/main/auth/AuthService.ts` — auth/onboarding orchestration.
- Create `src/main/auth/authIpc.ts` — narrow IPC registration.
- Modify `src/main/main.ts` — dependency composition only.

**Renderer**
- Create `src/renderer/services/auth/AuthClient.ts`, `DesktopAuthClient.ts`, `types.ts`.
- Create `src/renderer/app/SessionGate.tsx` and test.
- Create `src/renderer/features/auth/{AuthScreen,SignInForm,RegisterFlow,RecoveryFlow}.tsx`, CSS and tests.
- Create `src/renderer/features/onboarding/{Onboarding,PasswordStep,ProfileStep,CircleStep,ReadyStep}.tsx`, CSS and tests.
- Modify `src/renderer/app/App.tsx` and `src/renderer/main.tsx` so the shell is rendered only after auth state is known.

**Verification/docs**
- Modify `scripts/verify-boundaries.mjs`.
- Modify `README.md`.
- Modify `package.json` and `package-lock.json` only for `bcryptjs`, `nodemailer`, and Nodemailer typings.

---

### Task 1: Shared Contracts, Password Rules, and Pure-JS Password Crypto

**Files:**
- Modify `package.json`, `package-lock.json`, `src/shared/desktopApi.ts`
- Create `src/main/auth/passwordPolicy.ts`, `passwordPolicy.test.ts`, `passwordCrypto.ts`

**Produces:**

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
export interface InvitationCheckResult { hasPendingInvite: boolean; groupName: string | null; role: string | null }
export interface CircleContext {
  accountOrigin: AccountOrigin
  invitation: null | { groupId: string; groupName: string; role: string }
  groups: Array<{ id: string; name: string; role: string }>
}
```

- [ ] **Step 1: Add only cross-platform dependencies**

```bash
npm install bcryptjs nodemailer
npm install -D @types/nodemailer
```

Assert `package.json` does not add `better-sqlite3` or native `bcrypt`.

- [ ] **Step 2: Write the failing policy test**

```ts
import { describe, expect, it } from 'vitest'
import { assertValidPassword, normalizeEmail } from './passwordPolicy'

describe('passwordPolicy', () => {
  it('normalizes email', () => expect(normalizeEmail(' A@Example.COM ')).toBe('a@example.com'))
  it('accepts 12 and 72 chars', () => {
    expect(() => assertValidPassword('a'.repeat(12))).not.toThrow()
    expect(() => assertValidPassword('a'.repeat(72))).not.toThrow()
  })
  it('rejects outside 12-72 chars', () => {
    expect(() => assertValidPassword('a'.repeat(11))).toThrow('12 and 72')
    expect(() => assertValidPassword('a'.repeat(73))).toThrow('12 and 72')
  })
})
```

- [ ] **Step 3: Verify RED**

```bash
npx vitest run src/main/auth/passwordPolicy.test.ts
```

Expected: missing module failure.

- [ ] **Step 4: Implement policy and bcrypt-compatible helpers**

```ts
// passwordPolicy.ts
export const normalizeEmail = (email: string) => String(email ?? '').trim().toLowerCase()
export function assertValidPassword(password: string): void {
  const length = String(password ?? '').length
  if (length < 12 || length > 72) throw new Error('Password must be between 12 and 72 characters')
}
```

```ts
// passwordCrypto.ts
import { compare, hash } from 'bcryptjs'
export const hashPassword = (password: string) => hash(password, 12)
export const verifyPasswordHash = (password: string, passwordHash: string) => compare(password, passwordHash)
```

- [ ] **Step 5: Expand `DesktopApi` exactly**

```ts
export interface DesktopApi {
  app: { getVersion(): Promise<string>; getPlatform(): Promise<NodeJS.Platform> }
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

- [ ] **Step 6: Verify GREEN and commit**

```bash
npm run typecheck
npx vitest run src/main/auth/passwordPolicy.test.ts
git add package.json package-lock.json src/shared/desktopApi.ts src/main/auth/passwordPolicy* src/main/auth/passwordCrypto.ts
git commit -m "feat: define auth contracts and password rules"
```

---

### Task 2: Copy-Safe Legacy Database Import and Additive Auth Migration

**Files:**
- Create `src/main/database/database.ts`, `database.test.ts`, `migrations.ts`, `migrations.test.ts`

**Produces:**

```ts
resolveDatabasePaths(paths): { activePath: string; legacyPath: string }
prepareDatabase(paths): Promise<DatabaseSync>
withTransaction<T>(db: DatabaseSync, fn: () => T): T
runMigrations(db: DatabaseSync): void
```

- [ ] **Step 1: Write failing copy/migration tests**

Use temporary directories and real `DatabaseSync`. Cover:

```ts
it('creates a new database when no legacy DB exists')
it('copies legacy family.db before opening the rebuild DB')
it('never modifies the legacy source file')
it('migrates old users.password into users.password_hash')
it('preserves unrelated legacy tables and rows')
it('defaults existing legacy users to account_origin=existing and onboarding_completed=1')
```

Build a legacy fixture matching Jose's minimum schema:

```sql
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
CREATE TABLE records (id INTEGER PRIMARY KEY, extracted_text TEXT NOT NULL);
INSERT INTO records VALUES (1, 'preserve me');
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run src/main/database
```

Expected: missing module failure.

- [ ] **Step 3: Implement path/import policy**

Production paths:

```ts
const activePath = join(app.getPath('userData'), 'family.db')
const legacyPath = join(app.getPath('appData'), 'Family Circle', 'family.db')
```

If `activePath` does not exist and `legacyPath` exists and resolves to a different file, copy `legacyPath` to `activePath`. Never open the legacy source for write during import. A deliberate `FAMILY_CIRCLE_DB_PATH` development override may select a custom active DB path, but normal production migration remains copy-safe.

- [ ] **Step 4: Implement `node:sqlite` setup**

```ts
const db = new DatabaseSync(activePath)
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
```

Implement `withTransaction` using `BEGIN IMMEDIATE`, `COMMIT`, `ROLLBACK`.

- [ ] **Step 5: Implement additive migrations**

Fresh DB: create `users` with `password_hash TEXT NOT NULL` and the auth columns from the spec; create `password_reset_tokens`.

Copied Jose DB: introspect `PRAGMA table_info(users)` and add missing columns. If old `password` exists and `password_hash` does not:

```sql
ALTER TABLE users ADD COLUMN password_hash TEXT;
UPDATE users SET password_hash = password WHERE password_hash IS NULL;
```

Add/default:

```text
name
server_user_id
session_version DEFAULT 0
must_change_password DEFAULT 0
onboarding_completed DEFAULT 1 for pre-existing users
account_origin DEFAULT 'existing'
invitation_group_id
invitation_group_name
invitation_role
claimed_at
created_at
updated_at
```

Do not drop old `password`, `records`, Circle, Story, Vault, or other tables; later slices will migrate those features from the copied DB.

- [ ] **Step 6: Verify preservation and commit**

```bash
npx vitest run src/main/database
npm run typecheck
git add src/main/database
git commit -m "feat: migrate legacy family database safely"
```

---

### Task 3: User Repository

**Files:**
- Create `src/main/auth/UserRepository.ts`, `UserRepository.test.ts`

**Main-only record:**

```ts
export interface UserRecord {
  user: AuthUser
  passwordHash: string
  serverUserId: string | null
  sessionVersion: number
  invitation: null | { groupId: string; groupName: string; role: string }
}
```

**Produces:**

```ts
getRecordByEmail(email: string): Promise<UserRecord | null>
getRecordById(id: number): Promise<UserRecord | null>
createRegisteredUser(input: RegisterInput): Promise<AuthUser>
createInvitedUser(input: CreateInvitedUserInput): Promise<AuthUser>
verifyPassword(userId: number, password: string): Promise<boolean>
replacePassword(userId: number, password: string, options?: { clearMustChangePassword?: boolean }): Promise<AuthUser>
updateProfile(userId: number, name: string): Promise<AuthUser>
markOnboardingComplete(userId: number): Promise<AuthUser>
getSessionVersion(userId: number): Promise<number>
```

- [ ] **Step 1: Write failing repository tests**

Use `:memory:` DB + migrations. Cover normalized uniqueness, existing copied bcrypt hash verification, registered creation with name in one transaction, invited metadata/flags, wrong password, profile update, `replacePassword(...,{clearMustChangePassword:true})`, and session-version increment.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run src/main/auth/UserRepository.test.ts
```

- [ ] **Step 3: Implement repository**

Use `password_hash` only in new code. Shape `AuthUser` without main-only fields. `createRegisteredUser` sets `onboarding_completed=0`, `account_origin='registered'`; `createInvitedUser` sets `must_change_password=1`, `onboarding_completed=0`, `account_origin='invited'`.

`replacePassword` must update bcrypt hash and increment `session_version`; when `clearMustChangePassword` is true it also sets `must_change_password=0` in that same transaction.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/main/auth/UserRepository.test.ts
npm run typecheck
git add src/main/auth/UserRepository*
git commit -m "feat: add local user repository"
```

---

### Task 4: Protected 30-Day Session Store

**Files:**
- Create `src/main/auth/SessionStore.ts`, `SessionStore.test.ts`

**Interfaces:**

```ts
interface ProtectedCrypto { isAvailable(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
interface SessionFile { read(): Promise<Buffer | null>; write(value: Buffer): Promise<void>; remove(): Promise<void> }
interface SessionEnvelope { userId: number; sessionVersion: number; expiresAt: number }
```

- [ ] **Step 1: Write RED tests** for valid restore, expiry, corrupt payload, missing user, version mismatch, and clear using deterministic fake crypto/file/clock.

```bash
npx vitest run src/main/auth/SessionStore.test.ts
```

- [ ] **Step 2: Implement `save`, `restore`, `clear`**

`save(userId)` stores current `sessionVersion` and `expiresAt = now + 30 days`. `restore()` deletes invalid/expired/mismatched data and returns the safe user or `null`.

- [ ] **Step 3: Add Electron adapters**

Wrap `safeStorage.isEncryptionAvailable()`, `encryptString`, `decryptString`; persist bytes at `join(app.getPath('userData'),'auth-session.bin')`. No plaintext fallback.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/main/auth/SessionStore.test.ts
npm run typecheck
git add src/main/auth/SessionStore*
git commit -m "feat: add protected persistent sessions"
```

---

### Task 5: Password Recovery and Compatibility Mailer

**Files:**
- Create `src/main/auth/RecoveryMailer.ts`, `PasswordRecoveryService.ts`, `PasswordRecoveryService.test.ts`

**Mailer:**

```ts
export interface RecoveryMailer {
  sendCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void>
  sendChangedNotice(input: { to: string }): Promise<void>
}
```

- [ ] **Step 1: Write RED tests** for neutral known/unknown response, SHA-256-only token storage, 10-minute expiry, max 3/hour and 1/minute request throttling, 5 failed attempts, one-time use, old-password reuse rejection, and `sessionVersion` increment.

- [ ] **Step 2: Implement constants and code lifecycle**

```ts
const RESET_TTL_MS = 10 * 60 * 1000
const RESET_WINDOW_MS = 60 * 60 * 1000
const RESET_REQUEST_LIMIT = 3
const RESET_ATTEMPT_LIMIT = 5
```

Generate 8-digit code with `randomInt`, store SHA-256, compare with `timingSafeEqual`.

- [ ] **Step 3: Implement atomic reset**

One SQLite transaction consumes token, writes new bcrypt hash, sets `must_change_password=0`, increments `session_version`, and invalidates other unused tokens. The final reset operation validates `{ email, code, newPassword }` together; do not invent a separate code-verification endpoint.

- [ ] **Step 4: Implement Nodemailer compatibility transport**

Support main-process-only legacy env names:

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

Require TLS 1.2 minimum. If sending is disabled, the neutral recovery response still succeeds. Never expose or package these credentials in renderer/Vite configuration.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/main/auth/PasswordRecoveryService.test.ts
npm run typecheck
git add src/main/auth/RecoveryMailer.ts src/main/auth/PasswordRecoveryService*
git commit -m "feat: add secure password recovery"
```

---

### Task 6: Legacy Circle Auth Adapter

**Files:**
- Create `src/main/circle/LegacyCircleAuthAdapter.ts`, `LegacyCircleAuthAdapter.test.ts`

**Produces:**

```ts
checkInvitation(email: string): Promise<InvitationCheckResult>
claimInvitation(input: { email: string; enteredPassword: string }): Promise<ClaimedInvitation>
getMemberships(serverUserId: string): Promise<Array<{ id: string; name: string; role: string }>>
```

`ClaimedInvitation` is main-only and may include the verified temporary password needed to create the local bcrypt hash; it must never cross preload.

- [ ] **Step 1: Write RED tests** with injected fetch: safe invitation summary, header isolation, wrong temp password, full claim sequence, membership confirmation, timeout.

- [ ] **Step 2: Implement only these current compatibility paths**

```text
GET  /api/invitation-check?email=...
POST /api/register
POST /api/invitations/accept-link
POST /api/user/mark-claimed
GET  /api/me/{serverUserId}/groups
```

Constructor config:

```ts
{ baseUrl: string; apiKey: string; timeoutMs?: number }
```

Only this file may emit `X-Kin-Keepers-Key`. Production composition reads `CIRCLE_API_URL` and `CIRCLE_API_KEY`.

- [ ] **Step 3: Ensure public invitation check strips `tempPassword` and token**; verify and commit.

```bash
npx vitest run src/main/circle/LegacyCircleAuthAdapter.test.ts
npm run typecheck
git add src/main/circle
git commit -m "feat: isolate legacy circle auth compatibility"
```

---

### Task 7: Auth Service Orchestration

**Files:**
- Create `src/main/auth/AuthService.ts`, `AuthService.test.ts`

**State helper:**

```ts
function stateFor(user: AuthUser): AuthState {
  return user.mustChangePassword || !user.onboardingCompleted
    ? { status: 'onboarding', user }
    : { status: 'authenticated', user }
}
```

- [ ] **Step 1: Write RED tests** for: no-session restore, authenticated restore, onboarding restore, existing local success, existing wrong password with no invite fallback, first-time invited claim, failed membership with no local account creation, invitation recheck during registration, owner registration, sign out, initial-password replacement, profile update, invited Circle confirmation, completion actions.

- [ ] **Step 2: Implement existing/invited sign-in**

```text
normalized email
 -> local record exists: verify locally; wrong password stops here
 -> no local record: claim invitation through adapter
 -> only after membership confirmation create invited local user
 -> save protected session
 -> return safe AuthState
```

No local JWT.

- [ ] **Step 3: Implement registration**

Validate name/email/password; recheck invitation server-side; if one now exists throw a safe message directing the user to sign in; otherwise create registered user transactionally, save session, return onboarding state. React already gets Circle/role details from the explicit `checkInvitation` step and does not need structured remote details from a race-condition error.

- [ ] **Step 4: Implement onboarding**

`setInitialPassword` restores the current internal user, requires `mustChangePassword`, calls `replacePassword(...,{clearMustChangePassword:true})`, then saves a fresh session with the new version.

`updateProfile` requires 2+ trimmed characters.

`getCircleContext` uses the main-only `UserRecord.serverUserId` and invitation metadata. For invited users, confirm the expected Circle is present before returning it.

`complete('joined-circle')` is valid only for invited users with confirmed expected membership. Registered users may complete with only `create-circle` or `home`. Mark onboarding complete, refresh protected session, return authenticated state.

- [ ] **Step 5: Wire recovery/sign-out**

Recovery delegates to Task 5. Successful reset clears any current session. Sign out clears session.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run src/main/auth src/main/circle
npm run typecheck
git add src/main/auth/AuthService*
git commit -m "feat: orchestrate desktop authentication"
```

---

### Task 8: Narrow IPC and Preload Surface

**Files:**
- Create `src/main/auth/authIpc.ts`, `authIpc.test.ts`
- Modify `src/main/main.ts`, `src/preload/createDesktopApi.ts`, `src/preload/createDesktopApi.test.ts`

- [ ] **Step 1: Extend preload test first**

Require exactly:

```ts
Object.keys(api.auth) === ['restore','signIn','checkInvitation','register','signOut','requestPasswordReset','resetPassword']
Object.keys(api.onboarding) === ['getState','setInitialPassword','updateProfile','getCircleContext','complete']
```

Assert no `getToken`, `decodeToken`, `setApiKey`, `rawFetch`, or database capability.

- [ ] **Step 2: Verify RED**, then map methods to these IPC channels:

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

- [ ] **Step 3: Implement `authIpc` delegation tests** using a fake service. Domain methods receive payloads only, never raw Electron events.

- [ ] **Step 4: Compose dependencies in `main.ts`**

```text
prepare copied/migrated DB
UserRepository
SessionStore
RecoveryMailer
PasswordRecoveryService
LegacyCircleAuthAdapter
AuthService
registerAuthIpc
BrowserWindow
```

`main.ts` remains composition-focused.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/preload src/main/auth/authIpc.test.ts
npm run typecheck
git add src/main/main.ts src/main/auth/authIpc* src/preload/createDesktopApi*
git commit -m "feat: expose narrow desktop auth bridge"
```

---

### Task 9: Renderer Auth Client and Session Gate

**Files:**
- Create `src/renderer/services/auth/{AuthClient,DesktopAuthClient,types}.ts`
- Create `src/renderer/app/SessionGate.tsx`, `SessionGate.test.tsx`
- Modify `src/renderer/app/App.tsx`, `src/renderer/main.tsx`

- [ ] **Step 1: Write RED gate tests**: branded restoring state, unauthenticated -> auth screen, onboarding -> onboarding UI, authenticated -> shell, and Home never appears before restore resolves.

- [ ] **Step 2: Implement `AuthClient`** as domain operations over `window.desktop`; no fetch, URL, environment access, token, or key.

- [ ] **Step 3: Export current shell as `AuthenticatedApp`** and mount it only through `SessionGate`.

- [ ] **Step 4: Implement restore splash** with existing `BrandMark` and copy:

```text
Family Circle
Opening your private workspace...
```

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/renderer/app/SessionGate.test.tsx
npm run typecheck
git add src/renderer/services/auth src/renderer/app/SessionGate* src/renderer/app/App.tsx src/renderer/main.tsx
git commit -m "feat: gate shell behind protected session restore"
```

---

### Task 10: Branded Sign-In, Registration, and Recovery

**Files:**
- Create `src/renderer/features/auth/{AuthScreen,SignInForm,RegisterFlow,RecoveryFlow}.tsx`, `Auth.css`, `AuthScreen.test.tsx`

- [ ] **Step 1: Write RED tests** for sign-in success/failure, three-step registration, invitation check and prefilled return to sign-in, 12-72 password + confirmation, neutral recovery request, final `{email,code,newPassword}` reset, and prefilled sign-in after recovery.

- [ ] **Step 2: Implement one `AuthScreen` shell** with modes `sign-in | register | recover`; reuse official `BrandMark`, light canvas, navy text, teal primary action, restrained gold accents.

- [ ] **Step 3: Implement `SignInForm`** with email, password, show/hide, busy state, accessible status, Forgot Password and Create Account navigation.

- [ ] **Step 4: Implement `RegisterFlow`** with steps `name | email | password`. At email step call `checkInvitation`; invitation result stops registration and offers return to sign-in with email prefilled. Password step calls `register({name,email,password})` once.

- [ ] **Step 5: Implement `RecoveryFlow`** with UI states `email | code | password | complete`. The code step is presentation-only; final submit calls one reset operation with email+code+new password.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run src/renderer/features/auth
npm run typecheck
git add src/renderer/features/auth
git commit -m "feat: add branded auth front door"
```

---

### Task 11: Guided Invited and Owner Onboarding

**Files:**
- Create `src/renderer/features/onboarding/{Onboarding,PasswordStep,ProfileStep,CircleStep,ReadyStep}.tsx`, `Onboarding.css`, `Onboarding.test.tsx`

- [ ] **Step 1: Write RED tests** for invited password-first flow, skipped password when not required, profile save, confirmed Circle/role, retry after Circle failure without losing prior work, owner Create Circle/Explore First choices, and all three completion actions.

- [ ] **Step 2: Implement progress model**:

```text
Secure your account
Your profile
Your family circle
Ready
```

Skip/complete the password step when `mustChangePassword` is false.

- [ ] **Step 3: Implement steps**

Password calls only `setInitialPassword`; profile calls `updateProfile`; invited Circle calls `getCircleContext` and renders only confirmed membership; registered Circle step presents Create Circle and Explore First without creating a Circle in this slice.

- [ ] **Step 4: Implement completion**

Invited -> `complete('joined-circle')`; owner -> `complete('create-circle')` or `complete('home')`. Emit authenticated state to `SessionGate`.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/renderer/features/onboarding
npm run typecheck
git add src/renderer/features/onboarding
git commit -m "feat: add guided family circle onboarding"
```

---

### Task 12: Boundary Enforcement, Full Verification, and Docs

**Files:**
- Modify `scripts/verify-boundaries.mjs`, `README.md`
- Modify CI only if required for a verified build issue.

- [ ] **Step 1: Strengthen boundary verifier**

Fail renderer code on credential storage/access patterns and legacy details, including:

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

Continue banning direct `fetch()` in feature components.

Scan production `src/main/**/*.ts` and permit `X-Kin-Keepers-Key` and the current Circle endpoint literals only in `src/main/circle/LegacyCircleAuthAdapter.ts`.

- [ ] **Step 2: Add/extend source-boundary tests** so auth/onboarding renderer production files cannot use `localStorage.setItem`, `sessionStorage.setItem`, or `fetch(`.

- [ ] **Step 3: Update README** with local auth architecture, copy-safe import from old `Family Circle/family.db`, 30-day safeStorage session, no renderer token, legacy adapter isolation, `CIRCLE_API_URL`, `CIRCLE_API_KEY`, recovery SMTP env names, and explicit warning not to commit/package secrets.

- [ ] **Step 4: Run focused suite**

```bash
npx vitest run src/main/auth src/main/database src/main/circle src/preload src/renderer/features/auth src/renderer/features/onboarding src/renderer/app/SessionGate.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run full gate**

```bash
npm run check
npm audit
```

Expected: TypeScript PASS, all Vitest tests PASS, boundaries PASS, Electron build PASS, Vite production build PASS, and no unresolved high/critical runtime vulnerability.

- [ ] **Step 6: Commit final verification**

```bash
git add scripts/verify-boundaries.mjs README.md .github/workflows/desktop-shell-ci.yml
git commit -m "chore: verify auth onboarding boundaries"
```

- [ ] **Step 7: Run one fresh final `npm run check` after the final commit** and record the exact test count and commit SHA in the handoff. Do not claim completion from an earlier run.
