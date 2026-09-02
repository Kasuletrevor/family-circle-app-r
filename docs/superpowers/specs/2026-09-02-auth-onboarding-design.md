# Family Circle Auth and Onboarding Design

Date: 2026-09-02
Status: Approved design for implementation planning
Branch: `feature/auth-onboarding`

## Purpose

Build the complete Family Circle front door in the clean Electron + React + TypeScript rebuild while preserving the working behavior of the current application.

This slice includes persistent session restore, sign in, create account, invitation detection and first-time invitation claim, forgot/reset password, invited-user onboarding, new-owner onboarding, and sign out.

The implementation remains compatible with Jose's current Circle APIs for now, but the renderer must not depend on those endpoints or on legacy P2P naming. A future `/v2` backend must be replaceable behind adapters without rewriting the UI.

## Chosen Approach

Use a compatibility auth layer.

We will not copy the current auth implementation wholesale, and we will not block the desktop rebuild on a new server-first `/v2/auth` backend.

Instead:

- existing users authenticate against the local desktop identity store
- passwords remain bcrypt hashed
- first-time invited users may be resolved and claimed through the current Circle service
- password-recovery security rules are preserved
- onboarding remains aware of invited versus registered accounts
- persistent sessions move out of renderer storage and into Electron-protected storage
- React never receives a raw session credential

## Product Rules to Preserve

### Existing local users

1. User supplies email and password.
2. The desktop finds the local user by normalized email.
3. Password is verified against the bcrypt hash.
4. A protected desktop session is created.
5. If onboarding is complete, the user enters the app.
6. Otherwise the user enters onboarding.

### First-time invited users

1. User enters the email address and temporary password from the invitation email.
2. No local account exists yet.
3. `LegacyCircleAuthAdapter` checks the current Circle service for the invitation.
4. The temporary password is verified using the compatibility behavior required by the current service.
5. The shared user and invitation are resolved.
6. Membership is confirmed.
7. Only after sufficient shared-state confirmation is the local invited account created.
8. A protected local session is created.
9. The account is marked as requiring onboarding and a personal password.

Remote claim failures must not produce a falsely completed local account.

### New account registration

Registration is a three-step flow:

1. family-visible name
2. email and invitation check
3. password creation

Before creating a normal account, the system checks whether the email already has a pending family invitation. If so, registration stops and the user is guided to sign in with the invitation password instead of creating a duplicate identity.

The rebuild improves one detail: `name`, `email`, and `password` are committed as one registration domain operation and one local transaction rather than creating a nameless account and patching the profile later.

### Password requirements

Preserve the current rule:

- minimum 12 characters
- maximum 72 characters

### Password recovery

Preserve:

- neutral request response so account existence is not disclosed
- hashed recovery codes at rest
- 10-minute expiry
- request throttling
- attempt limiting
- one-time consumption
- new password must differ from the previous password
- successful reset increments `sessionVersion`, invalidating prior sessions

The three-step UI is presentation only:

1. email
2. collect recovery code
3. collect new password and submit code + new password together

We will **not invent a separate server-side "verify recovery code" endpoint** merely to match the UI steps. The code is validated atomically when the new password is submitted, preserving the current security behavior.

### Onboarding behavior

Invited users:

1. replace temporary password if required
2. confirm family-visible profile name
3. confirm invited Circle and role
4. complete onboarding
5. enter Family Circle

Registered/new-owner users:

1. confirm family-visible profile name
2. choose either Create a family Circle or Explore the app first
3. complete onboarding
4. enter Family Circle

The Explore-first path remains available.

## UX Structure

Authentication and onboarding must feel like one coherent Kin-Keepers entrance rather than unrelated legacy pages.

### Visual principles

Use the approved palette:

- deep navy `#0C2348`
- teal `#0E9F9A`
- dark teal `#0C6F70`
- warm gold `#E6AD69`
- pale mint `#E9FBF6`
- cool gray `#EEF2F7`
- white surfaces

Use the bundled official logo at `public/kin-cropped.jpg`.

The experience should be calm and application-like: no promotional carousel, no dark corporate wall, and no endpoint/database/token diagnostics.

### Startup SessionGate

The authenticated application shell must not render until session restoration is resolved.

```text
restoring
  -> unauthenticated
  -> onboarding
  -> authenticated
```

During `restoring`, show a short branded splash:

```text
[Kin-Keepers logo]
Family Circle
Opening your private workspace...
```

### Sign in

One branded card with:

- email
- password
- show/hide password
- Sign in
- Forgot password?
- Create an account

Busy and error states remain inside the card.

### Registration

Step 1 — Name

> What should your family call you?

Step 2 — Email

Explain that Family Circle will check whether the family has already invited the address.

If an invitation exists:

- stop normal registration
- show Circle name/role when available
- explain that the invitation password should be used
- return to sign in with email prefilled

Step 3 — Password

- password
- confirmation
- 12–72 character guidance

Successful registration creates the local account transactionally, creates a protected session, then enters onboarding.

### Recovery

Guided UI:

1. email
2. recovery code
3. new password

The request response remains:

> If an account exists for that email, a recovery code has been sent.

After successful reset, return to sign in with the email prefilled.

### Invited onboarding

Progress:

```text
Secure your account
Your profile
Your family circle
Ready
```

The password step is skipped/complete when `mustChangePassword` is false.

The Circle screen shows the invited Circle and role only after main-process membership confirmation.

### Registered-owner onboarding

The Circle step offers:

- Create a family circle
- Explore the app first

The chosen next action is normal application state, not an auth credential.

## Runtime Architecture

```text
React renderer
    |
    | AuthClient / typed desktop API
    v
Preload
    |
    | narrow typed IPC
    v
Electron main
    |
    +-- AuthService
    |     +-- UserRepository
    |     +-- SessionStore
    |     +-- PasswordRecoveryService
    |     +-- LegacyCircleAuthAdapter
    |
    +-- SQLite
    +-- Electron safeStorage
    +-- current Circle service
```

## Renderer Responsibilities

Target structure:

```text
src/renderer/
  features/
    auth/
      AuthScreen.tsx
      SignInForm.tsx
      RegisterFlow.tsx
      RecoveryFlow.tsx

    onboarding/
      Onboarding.tsx
      PasswordStep.tsx
      ProfileStep.tsx
      CircleStep.tsx
      ReadyStep.tsx

  services/
    auth/
      AuthClient.ts
      DesktopAuthClient.ts
      types.ts

  app/
    SessionGate.tsx
```

React owns forms, guided steps, client-side validation, busy/error presentation, state-based routing, and renderer-safe user/onboarding data.

React must not own:

- SQLite
- password hashing
- session encryption/decryption
- raw session credentials
- API keys
- raw Circle URLs
- direct auth networking
- legacy P2P configuration

Existing renderer-boundary checks remain mandatory.

## Main-Process Responsibilities

Target structure:

```text
src/main/
  auth/
    AuthService.ts
    UserRepository.ts
    PasswordRecoveryService.ts
    SessionStore.ts
    authIpc.ts

  circle/
    LegacyCircleAuthAdapter.ts

  database/
    database.ts
    migrations.ts
```

### AuthService

Orchestrates:

- restore session
- sign in
- register
- sign out
- set initial password
- get current user
- update onboarding profile
- fetch onboarding Circle context
- complete onboarding

It coordinates focused modules and must not become another giant mixed-purpose IPC file.

### UserRepository

Owns:

- normalized-email identity lookup
- transactional registered-user creation
- transactional invited-user creation
- find by email/id
- bcrypt verification
- password replacement
- profile update
- onboarding state
- `sessionVersion`
- invitation metadata

Password hashes never leave the main-process auth layer.

### PasswordRecoveryService

Owns:

- secure random recovery-code creation
- hashing
- 10-minute expiry
- request throttling
- failed-attempt counting
- one-time consumption
- password replacement
- session invalidation after reset

Email delivery remains behind a transport boundary.

### SessionStore

Persistent sign-in is approved.

No auth token/session is stored in renderer `localStorage` or `sessionStorage`.

Use Electron `safeStorage` in main. Store an encrypted local envelope conceptually shaped as:

```ts
{
  userId: number,
  sessionVersion: number,
  expiresAt: number
}
```

The protected session lifetime is **30 days**, preserving the lifetime of the old local JWT behavior. Successful sign-in/registration/claim refreshes the 30-day expiry.

Restore:

1. load encrypted session file
2. decrypt in main
3. parse envelope
4. reject/delete if expired
5. find local user
6. compare envelope `sessionVersion` to the current user version
7. reject/delete if mismatched
8. return renderer-safe state

All password-changing operations that replace the authenticated password—including password reset and replacing an invitation password—must invalidate older sessions by incrementing `sessionVersion` before writing the fresh session.

Sign out deletes the protected session.

`safeStorage` is wrapped behind an injectable interface so CI tests use a deterministic fake instead of OS keychain behavior.

### Why no local JWT

A locally issued JWT is unnecessary when React never holds the credential and Electron main queries the local identity store anyway.

```text
old concept:
issue JWT -> persist JWT -> verify JWT -> query local user

new concept:
encrypt session envelope -> validate user + sessionVersion
```

A future server-issued token can still exist behind `/v2`; this decision only removes an unnecessary local-only JWT abstraction.

## Legacy Circle Compatibility Adapter

`LegacyCircleAuthAdapter` is the only new module allowed to know current shared-service implementation details for authentication/onboarding compatibility.

It may know current endpoints for:

- invitation check
- shared-user registration/resolution
- invitation acceptance
- mark claimed
- memberships/groups lookup

The rest of the application uses domain operations such as:

```text
checkInvitation(email)
claimInvitation(...)
getMemberships(...)
confirmInvitedCircle(...)
```

Later replacement:

```text
LegacyCircleAuthAdapter -> V2CircleAuthAdapter
```

must not require React changes.

## Legacy Shared API Key

The current Circle service may temporarily require its app-wide shared key.

Use new internal configuration names:

```text
CIRCLE_API_URL
CIRCLE_API_KEY
```

The legacy adapter may translate `CIRCLE_API_KEY` to the current `X-Kin-Keepers-Key` header internally.

Rules:

- main process / legacy adapter only
- never returned through preload
- never referenced in React
- never stored in renderer storage
- never described as user identity or a secure per-user credential

Because it is distributed with a desktop application, this compatibility key must be treated as **application traffic gating, not a durable secret**. The `/v2` identity design should remove this model rather than trying to make the shared key stronger.

## Typed Preload Surface

Conceptual capabilities:

```text
desktop.auth.restore()
desktop.auth.signIn(...)
desktop.auth.register(...)
desktop.auth.signOut()
desktop.auth.requestPasswordReset(...)
desktop.auth.resetPassword(...)

desktop.onboarding.getState()
desktop.onboarding.setInitialPassword(...)
desktop.onboarding.updateProfile(...)
desktop.onboarding.getCircleContext()
desktop.onboarding.complete(...)
```

Explicitly excluded:

```text
getToken()
decodeToken()
setApiKey()
rawDatabase()
rawFetch()
```

Renderer-safe results contain authentication state, shaped current user, account origin, onboarding requirement, must-change-password state, Circle confirmation information, and recoverable user-facing errors.

## Local Data Model

### users

At minimum:

- id
- email (normalized/unique)
- password_hash
- name
- server_user_id nullable
- session_version default 0
- must_change_password
- onboarding_completed
- account_origin: `registered | invited | existing`
- invitation_group_id nullable
- invitation_group_name nullable
- invitation_role nullable
- claimed_at nullable
- created_at
- updated_at

Do not expand this slice into unrelated profile schema work.

### password_reset_tokens

- id
- user_id
- token_hash
- expires_at
- used_at nullable
- attempts
- created_at

## Error Handling

Renderer-facing failures describe the user's next action without raw network/database details.

Examples:

- incorrect password
- account not found; register or check invitation
- invitation found but membership not ready
- invitation check unavailable; check connection and retry
- recovery code expired
- too many recovery attempts; request a new code
- setup session invalid; sign in again

If Circle confirmation fails during invited onboarding, already-saved password/profile work remains intact and the Circle step is retryable.

## Preserve vs Rewrite

Preserve/port cleanly:

- bcrypt local authentication behavior
- 12–72 character password rule
- password-reset security rules
- invitation detection and claim sequence
- invited vs registered account origin
- onboarding state rules
- Create Circle vs Explore first

Rewrite cleanly:

- giant mixed-purpose `ipcMainHandlers.js`
- giant `userModel.js`
- renderer-held token state
- local JWT session
- plain electron-store secret storage
- renderer-accessible P2P configuration
- P2P naming in the new app
- direct legacy URLs in UI code

The old repo remains the behavioral reference.

## Security Invariants

1. No password hash leaves Electron main.
2. No protected-session payload leaves Electron main.
3. No Circle API key leaves Electron main.
4. No auth feature component performs `fetch()` directly.
5. No renderer code references legacy Circle endpoint URLs.
6. No auth token/session is stored in localStorage or sessionStorage.
7. Password replacement invalidates older sessions.
8. Sign out deletes the persistent session.
9. First-time invited account creation happens only after sufficient shared-state confirmation.
10. Startup never briefly renders the authenticated shell before session state is known.

## Testing Strategy

### UserRepository

- normalized email uniqueness
- transactional registration
- bcrypt verification
- wrong-password rejection
- invited-user creation
- profile update
- sessionVersion increment
- password replacement

### PasswordRecoveryService

- neutral unknown-account behavior
- token hashed at rest
- throttling
- expiry
- failed-attempt count
- maximum-attempt invalidation
- one-time use
- reject old-password reuse
- successful reset increments sessionVersion

### SessionStore

- encrypted write/read abstraction
- valid restore
- 30-day expiry handling
- corrupt payload rejection
- sessionVersion mismatch rejection
- sign-out deletion

### AuthService

- existing user success/wrong password
- new registration
- duplicate registration
- invitation detected during registration
- first-time invited claim
- failed invitation lookup
- failed membership confirmation
- onboarding-required result
- authenticated restore
- onboarding restore
- sign out

### React

- branded restoring state
- sign-in validation/failure/success
- three-step registration
- invitation diversion to sign in
- three-step recovery UI with atomic final reset submission
- invited onboarding
- registered-owner onboarding
- Create Circle choice
- Explore first choice
- retryable Circle-confirmation failure
- shell renders only after SessionGate resolves

### CI

Existing release gate remains:

```text
typecheck
tests
renderer boundary verification
production Electron build
production Vite build
```

Boundary verification should be expanded to detect renderer session-token storage and forbidden auth-networking patterns.

## Out of Scope

This slice does not include:

- full Circle management
- the actual Create-Circle feature beyond routing the chosen onboarding action
- `/v2` backend implementation
- SSO/social login
- biometric login
- MFA
- Vault encryption redesign
- offline-AI initialization redesign
- full profile management beyond onboarding essentials

## Definition of Done

1. App startup is controlled by SessionGate.
2. Persistent sessions restore without exposing a credential to React.
3. Existing local users can sign in.
4. New users can register through the guided flow.
5. Pending invitations divert ordinary registration correctly.
6. First-time invited users can claim through the compatibility adapter.
7. Password recovery works with preserved security controls.
8. Invited users can complete password/profile/Circle onboarding.
9. Registered users can choose Create Circle or Explore first.
10. Sign out removes the protected session.
11. Raw legacy endpoints and shared credentials remain out of renderer code.
12. All tests, boundary checks, type checks, and production builds pass.
