# Kin-Keepers Family Circle Desktop

A clean Electron + React + TypeScript rebuild of the Kin-Keepers Family Circle desktop application, preserving the existing product and Jose's current Circle service while moving privileged authentication, shared-service compatibility, and local data responsibilities behind narrow desktop boundaries.

## Current slice

This branch includes the secure desktop shell, protected authentication and onboarding, the real Circle Home, and the first protected shared-state management slice: **My Circles, Open Circle, Create Circle, and Invite Member**.

- Electron desktop shell with `contextIsolation: true`, renderer sandboxing, and Node integration disabled.
- React + TypeScript renderer with routed desktop navigation.
- Kin-Keepers navy/teal/gold design system with the official logo bundled at `public/kin-cropped.jpg`; `BrandMark` keeps a lightweight fallback only for asset-load failure.
- Local account sign-in with bcrypt-compatible password hashes, including compatibility with copied legacy hashes.
- Registration with server-side invitation recheck.
- First-time invited-user claim through Jose's current Circle service.
- Neutral, throttled, one-time password recovery with email delivery compatibility.
- Guided invited and registered-owner onboarding.
- 30-day protected desktop sessions encrypted through Electron `safeStorage` when OS encryption is available. There is no plaintext persistence fallback.
- Copy-safe migration of the old local Family Circle database.
- Real shared Circle Home reads for memberships, family tree state, and notifications through the protected desktop boundary.
- Real **My Circles** cards with authoritative per-Circle member counts.
- Membership-validated **Open Circle** with a local `active_circle_id` viewer preference.
- **Create Circle** through Jose's current API, including automatic shared-identity bootstrap when an authenticated local account has not yet been linked.
- Owner-only **Invite Member** flow with a fixed descriptive family-role list and normalized delivery outcomes.
- Intentional no-Circle state for accounts that have no memberships.
- Authenticated user identity, active Circle, and unread notification count in the shell without hardcoded profile or badge values.
- Automated renderer/main-process/public-contract boundary checks and dependency audit in CI.

Stories, Memories, and Upcoming items are not presented as fabricated real data. Those values remain absent until their actual source slices are migrated.

This slice intentionally does **not** add Circle rename/delete, member removal, leaving a Circle, invitation cancellation, or relationship/tree mutations. Those remain later slices.

## Desktop architecture

The renderer remains presentation-only:

```text
React UI
   ↓
typed renderer clients
   ├── DesktopAuthClient
   └── DesktopCircleClient
            ↓
window.familyCircle typed preload API
            ↓
explicit IPC handlers
            ↓
main-process services
   ├── AuthService
   └── CircleService
            ├── protected session identity
            ├── local active-Circle preference
            └── authorization / DTO sanitization
                    ↓
            LegacyCircleAuthAdapter
                    ↓
            Jose's current Circle service
```

For Circle management specifically:

```text
React My Circles
      ↓
DesktopCircleClient
      ↓
typed preload methods
      ↓
CircleService
  ├── derives the local account from the protected session
  ├── resolves/persists server_user_id
  ├── validates Circle membership and ownership
  ├── stores active_circle_id locally
  └── removes shared-service identity fields from public DTOs
      ↓
LegacyCircleAuthAdapter
      ↓
Jose's current Circle API
```

`DesktopCircleClient` is the single production renderer adapter for Circle reads and mutations. React feature components do not call Circle URLs directly and do not receive the compatibility API key, shared service identity, invitation token, or temporary password.

The renderer never receives a password hash, session credential, database handle, Circle API key, raw Circle API URL, raw shared `ownerId`, raw shared `userId`, or `serverUserId`. Auth state is not stored in renderer `localStorage` or `sessionStorage`, and there is no local JWT.

Password changes and resets increment `session_version`, invalidating older protected sessions.

## Shared identity rule

A local Family Circle account and a shared Circle-service account are not assumed to have the same ID.

Existing linked accounts use the persisted `server_user_id`. `CircleService` derives that shared identity from the protected desktop session and local user record before it performs reads or writes.

If a signed-in account has no `server_user_id`, ordinary Circle reads do not guess by reusing the local user ID. When the user explicitly creates a Circle, `CircleService` bootstraps the shared identity from the authenticated account's name/email through the compatibility adapter, persists the returned `server_user_id` immediately, and then performs Circle creation. If creation later fails, the successfully resolved shared identity remains linked rather than being rolled back.

The renderer never supplies a trusted caller identity such as `fromUserId` or `serverUserId`.

## Active Circle preference

The selected Circle is a local viewer preference stored as `active_circle_id` in the desktop user record. It is not shared authorization state.

Before `CircleService` persists a requested active Circle, it loads the signed-in user's memberships from the shared service and verifies that the Circle is still accessible. A stale local preference is repaired to a valid membership or cleared when no memberships remain.

Home, shell state, and My Circles are refreshed from authoritative shared state after confirmed mutations; the renderer does not optimistically invent remote success.

## Circle reads and management

The public Circle preload surface is deliberately narrow:

```text
circle.getOverview()
circle.getMyCircles()
circle.selectCircle(circleId)
circle.createCircle({ name })
circle.inviteMember({ circleId, email, role })
```

The IPC layer accepts only those business inputs and reconstructs safe payloads before calling `CircleService`. Extra renderer-supplied identity or secret-shaped fields are ignored.

### My Circles

`getMyCircles()` returns a safe view model with Circle ID, name, descriptive role, authoritative member count, and whether the Circle is locally active. Member counts are calculated from each Circle's actual shared tree rather than reusing the active Circle's count.

### Create Circle

The Create Circle dialog validates and trims the name locally, prevents duplicate in-flight submission, waits for the protected main-process result, then reloads the authoritative Circle list. Newly created Circles become the local active Circle only after the shared create call succeeds.

### Invite Member

Invite is shown in the UI only for Circles where the viewer is the `Circle owner`, but that UI condition is not the authorization boundary. `CircleService` independently reloads the viewer's memberships and verifies that the shared service identifies the signed-in user as the actual owner before it sends an invitation.

Relationship roles are descriptive family metadata only. The allowed invitation roles are exactly:

```text
Family member
Parent
Child
Spouse / Partner
Sibling
Grandparent
Grandchild
Guardian / Caregiver
```

`Circle owner` is deliberately excluded from the invitation-role list because ownership is authorization state, not a relationship label.

The compatibility adapter normalizes invitation results to one of:

```text
sent
already-pending
already-member
delivery-failed
```

Temporary passwords, invitation tokens, raw API responses, and mail/service details stay behind the main-process adapter.

## Real Home flow

```text
Home / TopBar
     ↓
DesktopCircleClient
     ↓
familyCircle.circle.getOverview()
     ↓
circle:get-overview
     ↓
CircleService
     ├── protected SessionStore
     ├── UserRepository → persisted server_user_id + active_circle_id
     └── LegacyCircleAuthAdapter
             ├── memberships
             ├── active Circle tree
             └── notifications
```

The main process selects the active Circle, identifies the signed-in tree person from the protected shared identity, and returns a normalized safe DTO. The renderer maps that DTO into Home and shell view models.

Simultaneous Home and shell consumers share one in-flight overview request. After Circle selection, creation, or invitation, `DesktopCircleClient` invalidates any prior in-flight overview reference so subsequent reads cannot reuse stale Circle state.

`MockCircleClient` remains available only for tests/demo fixtures. It is not the production service default.

## Copy-safe legacy database import

On startup the rebuild uses its own active database under the Electron user-data directory. If that active database does not yet exist and the legacy database exists at:

```text
%APPDATA%/Family Circle/family.db
```

Family Circle copies the legacy file first and runs additive migrations only against the copy. Jose's original database is never opened for migration writes.

The migration preserves legacy tables and rows, copies existing bcrypt-compatible `users.password` values into the new `password_hash` column where needed, and adds authentication/onboarding fields plus the local `active_circle_id` preference without dropping the old schema.

If the active database and legacy source resolve to the same canonical file, startup migration aborts instead of risking modification of the source database.

## Protected sessions

Successful sign-in stores only a small session envelope containing the local user ID, current session version, and a 30-day expiry. The envelope is encrypted with Electron `safeStorage` before it is written beneath the app user-data directory.

If OS-backed encryption is unavailable, the application does not silently fall back to plaintext persistent sessions.

## Circle compatibility boundary

All current Circle compatibility requests and the legacy `X-Kin-Keepers-Key` header are quarantined in:

```text
src/main/circle/LegacyCircleAuthAdapter.ts
```

Use only the current configuration names in the main process:

```text
CIRCLE_API_URL
CIRCLE_API_KEY
```

`CIRCLE_API_URL` is optional while the compatibility adapter still has the existing Circle endpoint as its internal default. `CIRCLE_API_KEY` is the transitional shared compatibility key; it is not treated as user authentication and is never exposed to the renderer.

Do not add new `P2P_SERVER` or `P2P_API_KEY` usage.

The current compatibility API remains in place for this rebuild. A later secure `/v2` API can replace the adapter incrementally without changing React feature components.

## Password recovery email configuration

Email delivery is enabled only when:

```text
SEND_EMAILS=true
```

The compatibility mailer understands these environment names:

```text
SMTP_HOST                 # fallback: MAIL_HOST
SMTP_PORT                 # fallback: EMAIL_PORT, default 587
SMTP_SECURE               # fallback: EMAIL_SECURE
SMTP_TIMEOUT_MS           # fallback: EMAIL_TIMEOUT_MS
MAIL_USER                 # fallback: EMAIL_USER
EMAIL_PASS                # fallback: MAIL_PASS
FROM_EMAIL                # optional sender override
```

When email delivery is disabled, recovery still returns the same neutral public response. Production recovery requires valid SMTP configuration so the user can receive the one-time code.

**Never commit Circle keys, SMTP passwords, recovery credentials, or other secrets into this repository, renderer assets, or a public `.env` file.** Supply them through the deployment/runtime environment.

## Local development

Requirements:

- Node.js 24
- npm

Install dependencies:

```bash
npm ci
```

Start the Electron + Vite development environment:

```bash
npm run dev
```

For integration against the current Circle service, configure the main-process environment as required:

```text
CIRCLE_API_URL=...
CIRCLE_API_KEY=...
```

Do not place real secrets in tracked files.

## Verification

Run the complete local verification gate:

```bash
npm run check
```

That command runs:

1. Renderer and Electron TypeScript checks.
2. Vitest tests.
3. Architecture-boundary verification.
4. Electron and Vite production builds.

CI additionally runs:

```bash
npm audit --audit-level=high
```

Individual commands are also available:

```bash
npm run typecheck
npm test
npm run verify:boundaries
npm run build
npm audit
```

The boundary verifier rejects renderer credential/token storage, direct feature network calls, Circle configuration/secrets, legacy API details, new `P2P_*` production usage, legacy Circle paths/header outside the quarantined main-process adapter, direct production Circle preload access outside `DesktopCircleClient`, production use of `MockCircleClient`, and shared-service identity fields in the public Circle contract or production Circle renderer code.

## Product boundary

Private/local responsibilities stay on the desktop: the copied SQLite database, protected session state, the local active-Circle preference, Vault/document data, personal stories, local media, embeddings, local AI, voice, and backup/restore as those slices are migrated.

Shared family responsibilities remain server-owned: Circles, memberships, invitations, relationships, shared tree state, notifications, and deliberately shared profile/content data.

This slice adds only the minimum shared writes required for Circle creation and owner invitations. Still excluded:

- Circle rename
- Circle delete
- member removal
- leaving a Circle
- invitation cancellation
- relationship mutations
- tree/node-position mutations
- secure `/v2` migration

Those can be added as separate protected slices without widening the renderer trust boundary.
