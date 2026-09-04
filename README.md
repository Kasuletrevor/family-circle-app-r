# Kin-Keepers Family Circle Desktop

A clean Electron + React + TypeScript rebuild of the Kin-Keepers Family Circle desktop application, preserving the existing product and Jose's current Circle service while moving privileged authentication, shared-service compatibility, and local data responsibilities behind narrow desktop boundaries.

## Current slice

This branch includes the secure desktop shell, protected authentication and onboarding, the real Circle Home, protected shared-state management for **My Circles, Open Circle, Create Circle, Invite Member, Members, and Invitations**, and the first real **private local Vault** slice.

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
- Membership-validated **Open Circle** and **Manage** actions using a local `active_circle_id` viewer preference.
- **Create Circle** through Jose's current API, including automatic shared-identity bootstrap when an authenticated local account has not yet been linked.
- Owner-only **Invite Member** flow with a fixed descriptive family-role list and normalized delivery outcomes.
- Real active-Circle **Members** and **Invitations** views.
- Owner-only invitation resend/cancel and non-owner member removal controls, with authorization repeated in `CircleService`.
- Non-owner **Leave Circle** with safe active-Circle fallback after the server confirms the leave.
- Confirmation dialogs for destructive remove/cancel/leave operations; destructive rows are never optimistically removed.
- A real **Vault** at `/vault` for private PDF, DOCX, and TXT files stored beneath the app's local user-data directory.
- Local document validation, 50 MiB safety limit, SHA-256 duplicate detection, private randomized storage, and text extraction without requiring AI.
- Exact-byte duplicates are rejected per local user; same-name files with different bytes are retained as separate versions instead of replacing earlier content.
- Extraction failures keep the source document stored and expose a safe retry action; successful extraction becomes `waiting_for_ai` until the separate Private AI slice is installed.
- Intentional no-Circle state for accounts that have no memberships.
- Authenticated user identity, active Circle, and unread notification count in the shell without hardcoded profile or badge values.
- Automated renderer/main-process/public-contract boundary checks and dependency audit in CI.

Stories, Memories, and Upcoming items are not presented as fabricated real data. Those values remain absent until their actual source slices are migrated.

This slice intentionally does **not** add Circle rename/delete, ownership transfer, relationship/tree mutations, or Private AI/RAG. Those remain later protected slices.

## Desktop architecture

The renderer remains presentation-only:

```text
React UI
   ↓
typed renderer clients
   ├── DesktopAuthClient
   ├── DesktopCircleClient
   └── DesktopVaultClient
            ↓
window.familyCircle typed preload API
            ↓
explicit IPC handlers
            ↓
main-process services
   ├── AuthService
   ├── CircleService
   │       ├── protected session identity
   │       ├── local active-Circle preference
   │       ├── authorization / DTO sanitization
   │       └── safe person-handle → internal identity resolution
   │               ↓
   │       LegacyCircleAuthAdapter
   │               ↓
   │       Jose's current Circle service
   └── VaultService
           ├── protected local-user identity
           ├── VaultRepository
           ├── VaultFileStore
           └── DocumentExtractor
```

For Circle management specifically:

```text
React My Circles / Members / Invitations
      ↓
DesktopCircleClient
      ↓
typed preload methods
      ↓
CircleService
  ├── derives the local account from the protected session
  ├── resolves persisted server_user_id
  ├── validates Circle membership and ownership
  ├── stores active_circle_id locally
  ├── re-fetches authoritative tree data before management mutations
  ├── resolves safe personId handles to internal member/invitation identities
  └── removes shared-service identity fields from public DTOs
      ↓
LegacyCircleAuthAdapter
      ↓
Jose's current Circle API
```

`DesktopCircleClient` is the single production renderer adapter for Circle reads and mutations. React feature components do not call Circle URLs directly and do not receive the compatibility API key, shared service identity, invitation ID/token, or temporary password.

`DesktopVaultClient` is the single production renderer adapter for Vault operations. React never chooses arbitrary filesystem paths, never receives the stored source path, SHA-256 hash, full extracted text, local user ID, embedding BLOB, or model path, and never talks to a local AI HTTP port directly.

The renderer never receives a password hash, session credential, database handle, Circle API key, raw Circle API URL, raw shared `ownerId`, raw shared `userId`, `serverUserId`, `targetServerUserId`, or trusted invitation ID. Auth state is not stored in renderer `localStorage` or `sessionStorage`, and there is no local JWT.

Password changes and resets increment `session_version`, invalidating older protected sessions.

## Shared identity rule

A local Family Circle account and a shared Circle-service account are not assumed to have the same ID.

Existing linked accounts use the persisted `server_user_id`. `CircleService` derives that shared identity from the protected desktop session and local user record before it performs reads or writes.

If a signed-in account has no `server_user_id`, ordinary Circle reads do not guess by reusing the local user ID. When the user explicitly creates a Circle, `CircleService` bootstraps the shared identity from the authenticated account's name/email through the compatibility adapter, persists the returned `server_user_id` immediately, and then performs Circle creation. If creation later fails, the successfully resolved shared identity remains linked rather than being rolled back.

The renderer never supplies a trusted caller identity such as `fromUserId` or `serverUserId`.

## Active Circle preference

The selected Circle is a local viewer preference stored as `active_circle_id` in the desktop user record. It is not shared authorization state and there is no separate “managed Circle” store.

Before `CircleService` persists a requested active Circle, it loads the signed-in user's memberships from the shared service and verifies that the Circle is still accessible. A stale local preference is repaired to a valid membership or cleared when no memberships remain.

`Open Circle` selects the Circle and opens Home. `Manage` selects the same Circle through the same protected path and opens Members.

Home, shell state, My Circles, and Circle details are refreshed from authoritative shared state after confirmed mutations; the renderer does not optimistically invent remote success.

## Circle reads and management

The public Circle preload surface is deliberately narrow:

```text
circle.getOverview()
circle.getMyCircles()
circle.getCircleDetails()
circle.selectCircle(circleId)
circle.createCircle({ name })
circle.inviteMember({ circleId, email, role })
circle.resendInvitation({ personId })
circle.cancelInvitation({ personId })
circle.removeMember({ personId })
circle.leaveCircle()
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

### Members and Invitations

`getCircleDetails()` reads the active Circle from protected desktop state and returns only safe member/invitation records. Confirmed members and pending invitations use a public `personId` handle; that handle is not a trusted shared-service user or invitation ID.

Before resend, cancel, or member removal, `CircleService` re-fetches the active Circle's authoritative memberships/tree and resolves the public `personId` to the internal identity required by Jose's compatibility API.

Authorization is enforced in main regardless of what the renderer displays:

```text
View details          current Circle member
Resend invitation     Circle owner only
Cancel invitation     Circle owner only
Remove member         Circle owner only; owner target forbidden
Leave Circle          non-owner member only
```

Resend reuses Jose's existing invite endpoint for an already-pending invitation. Cancel, member removal, and leave use Jose's existing compatibility endpoints, all quarantined in `LegacyCircleAuthAdapter`.

Remove, cancel, and leave require explicit confirmation. The renderer waits for the server result, then reloads authoritative details rather than removing rows optimistically. After a successful leave, `CircleService` selects another available Circle or clears `active_circle_id`, and the renderer returns to My Circles.

Known authorization/stale-state failures map to stable non-sensitive UI messages; SQL, SMTP, tokens, API details, and internal IDs are not rendered.

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

Simultaneous Home and shell consumers share one in-flight overview request. Circle details have an independent in-flight read. Selection, creation, invitation, and management mutations invalidate relevant Circle reads so subsequent consumers cannot reuse stale state.

`MockCircleClient` remains available only for tests/demo fixtures. It is not the production service default.

## Private local Vault

Vault is owned by the **restored protected local user**, not by a renderer-supplied identity and not by Circle membership. Its initial public operations are:

```text
vault.listDocuments()
vault.chooseAndUploadDocuments()
vault.openDocument({ documentId })
vault.retryExtraction({ documentId })
vault.deleteDocument({ documentId })
vault.onUploadProgress(listener)
```

The Electron main process owns the native file picker and all source/destination path resolution. The picker accepts PDF, DOCX, and TXT files. Validation includes extension/signature checks and an initial configurable **50 MiB per-document limit**. SHA-256 is computed locally and used only for per-user exact-byte duplicate detection.

Stored files use randomized names beneath private per-user Vault storage. A second upload with identical bytes returns `already-exists` and is not copied again. A same-name file with different bytes is retained independently using a display-name suffix such as `Family History (2).pdf`; the earlier source and metadata are not replaced.

Text extraction is entirely local and does **not** depend on Granite, Nomic, the Circle API, or any cloud service:

- PDF → local PDF parser.
- DOCX → Mammoth raw-text extraction.
- TXT → UTF-8 text.

A parser failure keeps the private source file and document row so the user can retry extraction. Successful extraction records word count and a short preview, then moves the document to `waiting_for_ai`. Upload remains available when AI is absent. Indexing/RAG is deliberately deferred to the linked Private AI implementation plan.

Private internals stay in the Electron main process and SQLite. In particular, the public Vault DTO/progress/result surface does **not** expose raw source or stored paths, the SHA-256 hash, full extracted text, `localUserId`, embedding BLOBs, or model paths. IPC reconstructs numeric document IDs and ignores extra renderer-supplied path, hash, or identity-shaped fields. The preload layer sanitizes the public DTO a second time before React receives it.

Open, retry, and delete always re-resolve document ownership from the protected session. A guessed document ID belonging to another local user resolves as not found. Delete is recoverable: the row is marked pending before source removal; filesystem failure restores an active retryable row, while a DB failure after source removal leaves a tombstone that a later Vault list repairs. The UI waits for confirmed deletion and never optimistically hides the document.

`DesktopVaultClient` is the only production renderer path to `window.familyCircle.vault`. The architecture boundary verifier rejects private Vault field names and direct local-AI port dependencies in production Vault renderer code and the public desktop contract.

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

The boundary verifier rejects renderer credential/token storage, direct feature network calls, Circle configuration/secrets, legacy API details, new `P2P_*` production usage, legacy Circle paths/header outside the quarantined main-process adapter, direct production Circle preload access outside `DesktopCircleClient`, production use of `MockCircleClient`, shared-service identity/invitation-secret fields in the public Circle contract or production Circle renderer code, private Vault internals in production Vault renderer/public-contract code, direct Vault preload access outside `DesktopVaultClient`, and direct dependencies on local AI HTTP ports from the Vault renderer.

## Product boundary

Private/local responsibilities stay on the desktop: the copied SQLite database, protected session state, the local active-Circle preference, Vault/document data, personal stories, local media, embeddings, local AI, voice, and backup/restore as those slices are migrated.

Shared family responsibilities remain server-owned: Circles, memberships, invitations, relationships, shared tree state, notifications, and deliberately shared profile/content data.

This slice includes the minimum protected shared writes for Circle creation, invitation delivery/management, member removal, and leaving a Circle, plus the private local Vault foundation. Still excluded:

- Circle rename
- Circle delete
- ownership transfer
- relationship mutations
- tree placeholder mutations
- tree/node-position mutations
- Private AI indexing/RAG
- secure `/v2` migration

Those can be added as separate protected slices without widening the renderer trust boundary. Circle settings and Family Tree editing remain later shared-state slices; Private AI builds on the Vault foundation only after this branch is reviewed and merged.
