# Kin-Keepers Family Circle Desktop

A clean Electron + React + TypeScript rebuild of the Kin-Keepers Family Circle desktop application, preserving the existing product and Jose's current Circle service while moving privileged authentication, shared-service compatibility, and local data responsibilities behind narrow desktop boundaries.

## Current slice

This branch includes the secure desktop shell, protected authentication front door, guided onboarding, and a **read-only real Circle Home**.

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
- Intentional no-Circle state for accounts that are not linked to a shared Circle identity or have no memberships.
- Authenticated user identity, active Circle, and unread notification count in the shell without hardcoded profile or badge values.
- Automated renderer/main-process boundary checks and dependency audit in CI.

This slice is deliberately **read-only** for shared Circle state. It does not yet create Circles, send invitations, mutate relationships, or write tree changes through the new UI.

Stories, Memories, and Upcoming items are also not presented as fabricated real data. Those values remain absent until their actual source slices are migrated.

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
            ↓
LegacyCircleAuthAdapter
            ↓
Jose's current Circle service
```

`DesktopCircleClient` is the single production renderer adapter for Circle reads. Home and shell consumers share the same typed client boundary; React feature components do not call Circle URLs directly and do not receive the compatibility API key.

The renderer never receives a password hash, session credential, database handle, Circle API key, or raw Circle API URL. Auth state is not stored in renderer `localStorage` or `sessionStorage`, and there is no local JWT.

Password changes and resets increment `session_version`, invalidating older protected sessions.

## Shared identity rule

A local Family Circle account and a shared Circle-service account are not assumed to have the same ID.

Existing linked accounts use the persisted `server_user_id`. `CircleService` derives that shared identity from the protected desktop session and local user record before it performs membership, tree, or notification reads.

If `server_user_id` is absent, the application does **not** guess by reusing the local user ID. Home returns an intentional not-linked/no-Circle state instead. Linking and Circle creation belong to a later mutation slice.

## Real read-only Home flow

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
     ├── UserRepository → persisted server_user_id
     └── LegacyCircleAuthAdapter
             ├── memberships
             ├── active Circle tree
             └── notifications
```

The main process selects the active Circle, identifies the signed-in tree person from the protected shared identity, and returns a normalized safe DTO. The renderer maps that DTO into Home and shell view models.

The first simultaneous Home and shell consumers share one in-flight overview request so startup does not unnecessarily duplicate the same Circle read.

`MockCircleClient` remains available only for tests/demo fixtures. It is not the production service default.

## Copy-safe legacy database import

On startup the rebuild uses its own active database under the Electron user-data directory. If that active database does not yet exist and the legacy database exists at:

```text
%APPDATA%/Family Circle/family.db
```

Family Circle copies the legacy file first and runs additive migrations only against the copy. Jose's original database is never opened for migration writes.

The migration preserves legacy tables and rows, copies existing bcrypt-compatible `users.password` values into the new `password_hash` column where needed, and adds authentication/onboarding columns without dropping the old schema.

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

The boundary verifier rejects renderer credential/token storage, direct auth/onboarding network calls, Circle configuration/secrets, legacy API details, new `P2P_*` production usage, current legacy Circle paths/header outside the quarantined main-process adapter, direct production Circle preload access outside `DesktopCircleClient`, and production use of `MockCircleClient`.

## Product boundary

Private/local responsibilities stay on the desktop: the copied SQLite database, protected session state, Vault/document data, personal stories, local media, embeddings, local AI, voice, and backup/restore as those slices are migrated.

Shared family responsibilities remain server-owned: Circles, memberships, invitations, relationships, shared tree state, notifications, and deliberately shared profile/content data.

This slice keeps Jose's current service contract available rather than replacing it in one big-bang migration. A later secure `/v2` API can replace the compatibility adapter incrementally without changing React feature components.
