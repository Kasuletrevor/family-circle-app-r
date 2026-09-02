# Family Circle Auth and Onboarding Design

Date: 2026-09-02
Status: Approved design for implementation planning
Branch: `feature/auth-onboarding`

## Purpose

Build the complete Family Circle front door in the clean Electron + React + TypeScript rebuild while preserving the working behavior of the current application.

This slice includes:

- persistent session restore
- sign in
- create account
- invitation detection and first-time invitation claim
- forgot-password request
- recovery-code verification/reset
- invited-user onboarding
- new-owner onboarding
- sign out

The implementation must remain compatible with Jose's current Circle APIs for now, but the renderer must not depend on those endpoints or on the legacy P2P naming model. The eventual `/v2` backend must be replaceable behind adapters without rewriting the UI.

## Chosen Approach

Use a compatibility auth layer.

We will not copy the current auth implementation wholesale, and we will not require a new server-first `/v2/auth` backend before the desktop rebuild can proceed.

Instead, the new application preserves the current product behavior behind clean boundaries:

- existing users authenticate against the local desktop identity store
- passwords remain bcrypt hashed
- first-time invited users may be resolved and claimed through the current Circle service
- recovery behavior and security limits are preserved
- onboarding remains aware of invited versus registered accounts
- persistent sessions move out of renderer storage and into Electron-protected storage

The renderer never receives a raw session credential.

## Product Rules to Preserve

The current application contains several product and security rules that are intentional and should survive the rebuild.

### Existing local users

1. User supplies email and password.
2. The desktop finds the local user by normalized email.
3. Password is verified against the bcrypt hash.
4. If the account is valid, a protected desktop session is created.
5. If onboarding is complete, the user enters the app.
6. If onboarding is incomplete, the user enters the onboarding flow.

### First-time invited users

1. User enters the email address and temporary password from the invitation email.
2. No local account exists yet.
3. The compatibility Circle adapter checks the current Circle service for the invitation.
4. The temporary password is verified.
5. The shared user and invitation are resolved.
6. Membership is confirmed.
7. Only after the shared state is sufficiently confirmed is the local invited account created.
8. A protected local session is created.
9. The account is marked as requiring onboarding and a personal password.

### New account registration

Registration is a three-step flow:

1. family-visible name
2. email and invitation check
3. password creation

Before creating a normal registered account, the system checks whether the email already has a pending family invitation. If so, registration stops and the user is guided to sign in with the temporary invitation password instead of accidentally creating a duplicate identity.

The new implementation improves one behavior: `name`, `email`, and `password` are committed as one registration domain operation and one local transaction, rather than creating a nameless account and patching the profile afterward.

### Password requirements

Preserve the existing password length rule:

- minimum: 12 characters
- maximum: 72 characters

### Password recovery

Preserve these existing protections:

- neutral response to recovery requests so account existence is not disclosed
- recovery code stored only as a hash
- short expiry window
- request throttling
- attempt limiting
- recovery code invalidation after use
- new password must differ from the previous password
- all old sessions invalidated after successful reset by incrementing `sessionVersion`

### Onboarding behavior

Invited users:

1. replace temporary password if required
2. confirm family-visible profile name
3. confirm the invited Circle and role
4. complete onboarding
5. enter Family Circle

Registered/new-owner users:

1. confirm family-visible profile name
2. choose one of:
   - create a family Circle
   - explore the app first
3. complete onboarding
4. enter Family Circle

The "Explore first" path must remain available so a user is not forced to configure a family network before seeing the product.

## UX Structure

Authentication and onboarding must feel like one coherent Kin-Keepers experience rather than a collection of unrelated legacy pages.

### Visual principles

Use the approved Kin-Keepers application palette:

- deep navy `#0C2348`
- teal `#0E9F9A`
- dark teal `#0C6F70`
- warm gold `#E6AD69`
- pale mint `#E9FBF6`
- cool gray `#EEF2F7`
- white application surfaces

Use the official bundled Kin-Keepers logo from `public/kin-cropped.jpg`.

The auth experience should be calm and application-like, not a promotional landing page. Avoid a dark corporate wall, giant illustration carousel, or noisy system/API status messages.

### Startup session gate

The main application shell must not render until session restoration is resolved.

State machine:

```text
restoring
  -> unauthenticated
  -> onboarding
  -> authenticated
```

During `restoring`, show a short branded splash such as:

```text
[Kin-Keepers logo]
Family Circle
Opening your private workspace...
```

No token, endpoint, database, or API diagnostics appear in the renderer.

### Sign in

One centered branded card:

- email
- password
- show/hide password
- Sign in
- Forgot password?
- Create an account

Busy and error states remain inside the card.

### Registration

Step 1: name

- "What should your family call you?"

Step 2: email

- explain that Family Circle will check whether the family has already invited this address

If an invitation is detected:

- stop the normal registration flow
- display the Circle name/role when available
- explain that the user should use the temporary password from the invitation email
- provide a direct action back to sign in with the email prefilled

Step 3: password

- password
- confirmation
- 12-72 character guidance

On successful registration:

- create the local account transactionally
- create protected session
- enter onboarding

### Recovery

One guided three-step flow:

1. email
2. recovery code
3. new password

The request response is always neutral:

> If an account exists for that email, a recovery code has been sent.

After successful reset, return to sign in with the email prefilled.

### Invited onboarding

Progress model:

```text
Secure your account
Your profile
Your family circle
Ready
```

The first step is omitted or considered complete when `mustChangePassword` is false.

The Circle confirmation screen shows the invited Circle and role only after the main process confirms the shared membership context.

### Registered-owner onboarding

The Circle step presents two clear choices:

- Create a family circle
- Explore the app first

The chosen next action is returned as ordinary application state, not stored as an auth secret.

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

React is responsible for:

- displaying forms and guided steps
- client-side field validation for fast feedback
- busy, success, and failure presentation
- routing between auth/onboarding/app states
- rendering safe current-user and onboarding-context data

React is not responsible for:

- SQLite access
- password hashing
- session encryption/decryption
- raw session tokens
- API keys
- raw Circle URLs
- direct network calls for auth
- legacy P2P configuration

Feature components must continue to obey the repository's renderer-boundary checks.

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

Owns authentication orchestration and application-level outcomes.

Examples:

- restore session
- sign in
- register
- sign out
- set initial password
- get current user
- update onboarding profile
- fetch onboarding Circle context
- complete onboarding

It coordinates repositories/adapters but does not contain raw renderer code or giant mixed-purpose IPC logic.

### UserRepository

Owns local user persistence and identity rules.

Responsibilities include:

- normalize email
- create registered user transactionally
- create invited user transactionally
- find user by email/id
- verify bcrypt password
- update password hash
- update family-visible profile
- update onboarding state
- increment/read session version
- read invitation metadata

The repository returns shaped user objects and must never expose password hashes outside the main-process auth layer.

### PasswordRecoveryService

Owns:

- secure random recovery-code creation
- hashing
- expiry
- request throttling
- attempt counting
- one-time consumption
- password replacement
- session invalidation after reset

Email delivery remains behind a transport/service boundary so it can preserve the current behavior now and change later.

### SessionStore

Persistent login is approved.

Do not persist the session in renderer `localStorage`.

Use Electron `safeStorage` in the main process.

Store a small local session envelope, conceptually:

```ts
{
  userId: number,
  sessionVersion: number,
  expiresAt: number
}
```

The envelope is encrypted with `safeStorage.encryptString(...)` and written under Electron `userData`.

Restore sequence:

1. load encrypted session file
2. decrypt in main process
3. parse envelope
4. reject if expired
5. find local user
6. compare stored `sessionVersion` to current user `sessionVersion`
7. reject/delete if mismatched
8. return safe session state to renderer

Successful password reset/change increments `sessionVersion`, invalidating previously persisted sessions.

Sign out deletes the protected session.

### Why no local JWT

The new architecture does not need a locally issued JWT for renderer-to-main communication because the renderer never possesses the credential and the main process queries the local identity store anyway.

Removing the local JWT avoids unnecessary complexity:

```text
issue JWT -> encrypt JWT -> decrypt JWT -> verify JWT -> query local user
```

becomes:

```text
encrypt small session envelope -> validate against local user/sessionVersion
```

This does not prevent a future server session/token from being introduced behind `/v2`; it only removes an unnecessary local-only JWT abstraction.

## Legacy Circle Compatibility Adapter

`LegacyCircleAuthAdapter` is the only new module allowed to know the current shared-service implementation details for auth/onboarding compatibility.

It may internally know endpoints such as:

- invitation check
- shared-user registration/resolution
- invitation acceptance
- mark claimed
- memberships/groups lookup

The rest of the application sees domain operations such as:

```text
checkInvitation(email)
claimInvitation(...)
getMemberships(...)
confirmInvitedCircle(...)
```

This enables a later replacement:

```text
LegacyCircleAuthAdapter -> V2CircleAuthAdapter
```

without changing React screens or AuthService contracts.

## Legacy Shared API Key

The current Circle service may temporarily require its existing app-wide shared key.

Compatibility rule:

- the key may exist only in Electron main configuration and the legacy adapter
- it must not be returned through preload
- it must not appear in React
- it must not be stored in renderer localStorage/sessionStorage
- it must not be confused with per-user authentication

Use new internal configuration names:

```text
CIRCLE_API_URL
CIRCLE_API_KEY
```

The legacy adapter may translate `CIRCLE_API_KEY` to the current `X-Kin-Keepers-Key` header internally.

The eventual `/v2` identity design should remove this application-wide credential model.

## Typed Preload Surface

The renderer receives a narrow typed capability surface.

Conceptual shape:

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

The returned types contain only renderer-safe state such as:

- authenticated
- current user
- account origin
- onboarding required
- must-change-password
- Circle confirmation information
- recoverable error codes/messages

## Data Model

The local database must support at least:

### users

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

Existing profile fields may be migrated as needed by later profile/features, but this auth slice should not expand scope unnecessarily.

### password_reset_tokens

- id
- user_id
- token_hash
- expires_at
- used_at nullable
- attempts
- created_at

## Error Handling

Renderer-facing errors should describe the user's next action without exposing raw network or database details.

Examples:

- incorrect password
- account not found / register or check invitation
- invitation found but shared membership not ready
- unable to check invitation because connection is unavailable
- recovery code expired
- too many recovery attempts; request a new code
- setup session invalid; sign in again

Remote failures during invitation claim must not produce a falsely completed local account state.

When Circle confirmation fails during invited onboarding, already-saved password/profile work remains intact and the user can retry the Circle step.

## Migration and Compatibility Rules

Preserve or port cleanly:

- bcrypt local authentication behavior
- password length rule
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
- P2P naming in the new application
- direct legacy URLs in UI code

The old repo remains the behavioral reference during implementation.

## Security Boundaries

Required invariants:

1. No password hash leaves Electron main.
2. No protected-session payload leaves Electron main.
3. No Circle API key leaves Electron main.
4. No auth feature component performs `fetch()` directly.
5. No renderer code references legacy Circle endpoint URLs.
6. No auth token is stored in localStorage or sessionStorage.
7. Password reset invalidates old sessions.
8. Sign out deletes the persistent session.
9. First-time invited account creation occurs only after sufficient shared-state confirmation.
10. Startup does not briefly render the authenticated shell before session state is known.

## Testing Strategy

### UserRepository tests

Cover:

- normalized email uniqueness
- registration transaction
- bcrypt verification
- wrong-password rejection
- invited-user creation
- profile update
- sessionVersion increment
- password replacement

### PasswordRecoveryService tests

Cover:

- neutral unknown-account request behavior
- token is hashed at rest
- request throttle
- expiry
- failed-attempt count
- maximum-attempt invalidation
- one-time use
- rejection of old password reuse
- successful reset increments sessionVersion

### SessionStore tests

Cover:

- encrypted write/read abstraction
- valid restore
- expiry rejection
- invalid/corrupt payload rejection
- sessionVersion mismatch rejection
- sign-out deletion

`safeStorage` itself should be wrapped behind an injectable interface so tests can use a deterministic fake rather than relying on OS keychain behavior in CI.

### AuthService tests

Cover:

- existing local user success
- existing local user wrong password
- registered new user
- duplicate registration
- invitation detected during registration
- first-time invited login/claim
- failed invitation lookup
- failed membership confirmation
- onboarding-required result
- restore authenticated session
- restore onboarding session
- sign out

### React tests

Cover:

- branded restoring state
- sign-in validation and failure
- successful sign-in route decision
- three-step registration
- invitation diversion to sign in
- password-recovery three-step flow
- invited onboarding
- registered-owner onboarding
- Create Circle choice
- Explore first choice
- retryable Circle-confirmation failure
- authenticated shell only after SessionGate resolution

### CI

The existing full check remains the release gate:

```text
typecheck
unit/component tests
renderer boundary verification
production Electron build
production Vite build
```

Boundary verification should be expanded where appropriate to detect renderer session-token storage and forbidden auth networking patterns.

## Out of Scope for This Slice

Do not expand this implementation into:

- full Circle management
- creating the actual Circle backend operation beyond routing the chosen onboarding action
- `/v2` backend implementation
- SSO/social login
- biometrics login
- MFA
- Vault encryption redesign
- offline AI initialization redesign
- full profile management beyond onboarding name/profile essentials

Those can build on this identity/session foundation later.

## Definition of Done

This slice is complete when:

1. The app opens through a SessionGate.
2. Persistent sessions restore without exposing a token to React.
3. Existing local users can sign in.
4. New users can register through the guided flow.
5. Pending invitations divert ordinary registration correctly.
6. First-time invited users can claim through the compatibility adapter.
7. Password recovery works with the preserved security controls.
8. Invited users can complete secure-password/profile/Circle onboarding.
9. Registered users can choose Create Circle or Explore first.
10. Sign out removes the protected session.
11. Raw legacy endpoints and shared credentials remain out of renderer code.
12. All tests, boundary checks, type checks, and production builds pass.
