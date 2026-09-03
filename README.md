# Kin-Keepers Family Circle Desktop

A clean Electron + React + TypeScript rebuild of the Kin-Keepers Family Circle desktop application, preserving the existing product and Jose's current Circle service while moving privileged authentication and local data responsibilities behind a narrow desktop boundary.

## Current slice

This branch includes the secure desktop shell, protected authentication front door, guided onboarding, and polished Home experience.

- Electron desktop shell with `contextIsolation: true`, renderer sandboxing, and Node integration disabled.
- React + TypeScript renderer with routed desktop navigation.
- Kin-Keepers navy/teal/gold design system. `BrandMark` currently falls back to the branded `K` mark if `/kin-cropped.jpg` is not packaged; the exact private-repository logo binary is still an asset-packaging follow-up.
- Local account sign-in with bcrypt-compatible password hashes, including compatibility with copied legacy hashes.
- Registration with server-side invitation recheck.
- First-time invited-user claim through Jose's current Circle service.
- Neutral, throttled, one-time password recovery with email delivery compatibility.
- Guided invited and registered-owner onboarding.
- 30-day protected desktop sessions encrypted through Electron `safeStorage` when OS encryption is available. There is no plaintext persistence fallback.
- Copy-safe migration of the old local Family Circle database.
- Home overview with family metrics, events, activity, tree preview, member details, and local-AI status.
- Automated renderer/main-process boundary checks.

The authenticated Home/Circle data service remains mocked in this slice. The auth/onboarding compatibility paths are connected through the main-process legacy adapter; the rest of the shared Circle feature migration comes later.

## Local auth architecture

The renderer is presentation-only:

```text
React auth/onboarding UI
        ↓
DesktopAuthClient
        ↓
window.familyCircle typed preload API
        ↓
12 explicit IPC handlers
        ↓
AuthService
   ├── UserRepository → local SQLite copy
   ├── SessionStore → Electron safeStorage
   ├── PasswordRecoveryService → local reset rules + SMTP mailer
   └── LegacyCircleAuthAdapter → Jose's current Circle service
```

The renderer never receives a password hash, session credential, database handle, Circle API key, or raw Circle API URL. Auth state is not stored in renderer `localStorage` or `sessionStorage`, and there is no local JWT.

Password changes and resets increment `session_version`, invalidating older protected sessions.

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

All current Circle authentication/onboarding paths and the legacy `X-Kin-Keepers-Key` header are quarantined in:

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

For auth/onboarding integration against the current Circle service, configure the main-process environment as required:

```text
CIRCLE_API_URL=...
CIRCLE_API_KEY=...
```

Do not place real secrets in tracked files.

## Verification

Run the complete verification gate:

```bash
npm run check
```

That command runs:

1. Renderer and Electron TypeScript checks.
2. Vitest tests.
3. Architecture-boundary verification.
4. Electron and Vite production builds.

Individual commands are also available:

```bash
npm run typecheck
npm test
npm run verify:boundaries
npm run build
npm audit
```

The boundary verifier rejects renderer credential/token storage, direct auth/onboarding network calls, Circle configuration/secrets, legacy API details, new `P2P_*` production usage, and current legacy Circle paths/header outside the quarantined main-process adapter.

## Product boundary

Private/local responsibilities stay on the desktop: the copied SQLite database, protected session state, Vault/document data, personal stories, local media, embeddings, local AI, voice, and backup/restore as those slices are migrated.

Shared family responsibilities remain server-owned: Circles, memberships, invitations, relationships, shared tree state, notifications, and deliberately shared profile/content data.

This slice keeps Jose's current service contract available rather than replacing it in one big-bang migration. A later secure `/v2` API can replace the adapter incrementally without changing the React feature components.
