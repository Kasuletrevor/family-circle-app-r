# Kin-Keepers Family Circle Desktop

A clean Electron + React + TypeScript rebuild of the Kin-Keepers Family Circle desktop application, preserving the existing product and Jose's current Circle service while moving privileged authentication, shared-service compatibility, local data, and Private AI responsibilities behind narrow desktop boundaries.

## Current slice

This branch includes the secure desktop shell, protected authentication and onboarding, the real Circle Home, protected shared-state management for **My Circles, Open Circle, Create Circle, Invite Member, Members, and Invitations**, a real **private local Vault**, private local **My Story**, and optional **local Private AI + private archive retrieval**.

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
- Extraction failures keep the source document stored and expose a safe retry action; successful extraction becomes `waiting_for_ai` when Private AI is not ready and can be indexed later without re-upload.
- A private local **My Story** subsystem with fixed guided prompts, drafts, confirmation state, history, media, and local indexing of confirmed content only.
- Optional user-triggered Private AI setup with resumable downloads, immutable size/SHA verification, pause/continue/repair states, and no automatic ~671 MiB Private AI download at app startup.
- Persistent Nomic chunk embeddings stored locally in SQLite for Vault documents and confirmed Story answers; stored chunks are not re-embedded for each question.
- One `PrivateArchiveQueryService` ranks eligible Story + Vault chunks together with a **shared maximum of three chunks**.
- High-confidence confirmed Story facts can bypass embeddings and generation through a deterministic local lookup.
- Normal grounded generation and explicit combined synthesis use **Qwen3.5-0.8B Q4_K_M** on one local runtime, with 192- and 384-token output ceilings respectively.
- The existing **Ask your Vault** UI at `/ai` remains Vault-scoped and now delegates to that shared low-latency engine; Story/combined query surfaces can reuse the same backend without widening the renderer trust boundary.
- All/selected-document Vault scope keeps protected per-user document-ID validation and safe source excerpts.
- Intentional no-Circle state for accounts that have no memberships.
- Authenticated user identity, active Circle, and unread notification count in the shell without hardcoded profile or badge values.
- Automated renderer/main-process/public-contract boundary checks, private-RAG privacy/lifecycle regressions, and dependency audit in CI.

Upcoming/shared content is not presented as fabricated real data. Shared responsibilities remain absent until their actual source slices are migrated.

This slice intentionally does **not** add Circle rename/delete, ownership transfer, relationship/tree mutations, tree editing, automatic Story sharing, cloud AI/transcription, or the future secure `/v2` Circle API migration. Those remain separate protected slices.

## Desktop architecture

The renderer remains presentation-only:

```text
React UI
   ↓
typed renderer clients
   ├── DesktopAuthClient
   ├── DesktopCircleClient
   ├── DesktopVaultClient
   ├── DesktopStoryClient
   └── DesktopPrivateAiClient
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
   ├── VaultService
   │       ├── protected local-user identity
   │       ├── VaultRepository
   │       ├── VaultFileStore
   │       └── DocumentExtractor
   ├── StoryService / StoryMediaService
   │       └── private local Story repositories + media
   └── Private local AI / retrieval
           ├── OfflineAiAssetService
           ├── AiRuntimeManager
           ├── VaultIndexService + StoryIndexService
           ├── VaultChunkRepository + StoryChunkRepository
           ├── NomicClient
           ├── StoryDirectAnswerService
           ├── PrivateArchiveQueryService
           └── QwenClient
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

`DesktopVaultClient` is the single production renderer adapter for Vault operations, including grounded Vault questions. `DesktopPrivateAiClient` is the single production renderer adapter for setup/status/progress actions. Story feature code uses its typed Story client. React never chooses arbitrary filesystem paths, never receives stored source paths, SHA-256 hashes, full extracted text, local user IDs, embedding BLOBs/vectors, model paths, local model endpoints, or AI process details.

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

Vault is owned by the **restored protected local user**, not by a renderer-supplied identity and not by Circle membership. Its public operations include:

```text
vault.listDocuments()
vault.chooseAndUploadDocuments()
vault.openDocument({ documentId })
vault.retryExtraction({ documentId })
vault.retryIndexing({ documentId })
vault.deleteDocument({ documentId })
vault.ask({ question, scope })
vault.onUploadProgress(listener)
```

The Electron main process owns the native file picker and all source/destination path resolution. The picker accepts PDF, DOCX, and TXT files. Validation includes extension/signature checks and an initial configurable **50 MiB per-document limit**. SHA-256 is computed locally and used only for per-user exact-byte duplicate detection.

Stored files use randomized names beneath private per-user Vault storage. A second upload with identical bytes returns `already-exists` and is not copied again. A same-name file with different bytes is retained independently using a display-name suffix such as `Family History (2).pdf`; the earlier source and metadata are not replaced.

Text extraction is entirely local and does **not** depend on Qwen, Nomic, the Circle API, or any cloud service:

- PDF → local PDF parser.
- DOCX → Mammoth raw-text extraction.
- TXT → UTF-8 text.

A parser failure keeps the private source file and document row so the user can retry extraction. Successful extraction records word count and a short preview. If Private AI is unavailable it remains `waiting_for_ai`; after verified setup, existing extraction-ready documents can be indexed without re-uploading. Upload remains available in every AI state.

Private internals stay in the Electron main process and SQLite. In particular, the public Vault DTO/progress/result surface does **not** expose raw source or stored paths, the SHA-256 hash, full extracted text, `localUserId`, embedding BLOBs/vectors, model paths, local model endpoints, or AI process details. IPC reconstructs numeric document IDs/scope and ignores or rejects untrusted identity/path-shaped input. The preload layer sanitizes public DTOs a second time before React receives them.

Open, retry, query, and delete always re-resolve document ownership from the protected session. A guessed document ID belonging to another local user resolves as not found. Delete is recoverable: the row is marked pending before source removal; filesystem failure restores an active retryable row, while a DB failure after source removal leaves a tombstone that a later Vault list repairs. The UI waits for confirmed deletion and never optimistically hides the document.

`DesktopVaultClient` is the only production renderer path to `window.familyCircle.vault`. The architecture boundary verifier rejects private Vault/AI field names and direct local-AI port dependencies in production renderer code and the public desktop contract.

## Private local My Story

My Story is private local desktop state, not Circle/server content. Draft answers can be stored without AI. Confirmation is the privacy/indexing gate: only confirmed answers are eligible for Story chunk indexing and private retrieval. If confirmed text is materially edited, its previous chunks are invalidated and the changed answer must be confirmed again before it becomes queryable.

Story history, media ownership, and restore behavior remain local-user scoped. Raw local media paths and local user IDs are not exposed to React.

## Private AI and private archive retrieval

Private AI is optional and explicitly user-triggered. The app does not silently download its roughly **671 MiB** required runtime/model stack on startup, sign-in, upload, or Story editing. The public setup states are exactly:

```text
not_installed
downloading
paused
verifying
ready
repair_required
failed
```

The configured llama.cpp runtime, Qwen3.5-0.8B Q4_K_M generation model, and Nomic embedding model must pass immutable expected size/SHA verification before setup reaches `ready`. Resumable `.part` downloads are staged beneath the app user-data directory; pause preserves valid partial bytes and repair re-runs verified setup.

Indexing uses Nomic only. Vault extraction-ready text and confirmed Story answers are chunked and embedded with the `search_document: ` prefix, then persisted locally with model/version metadata. The generation model is never required for indexing.

For semantic questions, the service loads already-persisted eligible chunks and ranks all candidates together with in-process cosine similarity. The context budget is a single **top three chunks total** across the selected private sources. Vault document chunks and Story chunks are not re-embedded on every question.

For supported direct Story fact questions, `StoryDirectAnswerService` reads the canonical confirmed Story field and returns without starting Nomic or Qwen.

Normal grounded generated questions use the shared local Qwen runtime with a 192-token output ceiling. Explicit combined synthesis uses the same Qwen runtime with a 384-token output ceiling. Qwen reasoning is disabled at llama.cpp startup, and there is no cloud fallback.

English semantic retrieval embeds one query. Where a supported non-English query language is supplied, retrieval can use the original query plus a local English translation. The same already-produced English translation is also considered when selecting the normal versus complex Qwen response budget, so explicit combined synthesis in supported non-English languages is not under-routed. Translation failure falls back to the original query rather than a network service.

The existing `/ai` renderer surface remains **Ask your Vault**, so its public response stays the legacy safe `{answer, sources}` Vault DTO. Internally it delegates to `PrivateArchiveQueryService` with a Vault-only scope. Story and combined scopes remain main-process capabilities for the next UI surface rather than being exposed by widening the current Vault contract.

All model servers are main-process-owned, loopback-only, lazy, and stopped on application shutdown:

```text
Qwen3.5-0.8B generation / translation   8080
Nomic embedding/search                   8081
```

The port numbers are developer implementation details and are rejected from the production renderer/public contract.

Developer/runtime details, hashes, lifecycle rules, benchmark usage, and the Windows clean-machine acceptance procedure are documented in [`docs/PRIVATE_AI.md`](docs/PRIVATE_AI.md).

## Windows installer

Windows x64 builds use a one-click per-user NSIS installer named `Family-Circle-Setup-${version}.exe`. **GitHub Releases are the canonical public download source.** Branch and pull-request packaging runs also publish the installer as a GitHub Actions artifact for verification.

The normal installer stays small: Private AI is not bundled and is downloaded only after the user explicitly chooses **Set up Private AI**. `.env` files, model/runtime payloads, Vault/Story data, and user data are excluded from the package. See [`docs/WINDOWS_RELEASE.md`](docs/WINDOWS_RELEASE.md) for the exact build commands, release workflow, unsigned-installer/SmartScreen note, and 12-step clean-machine acceptance test.

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

Private AI requires no cloud AI credential. Model/runtime setup is performed explicitly from the application using `config/offline-ai-manifest.json`. See `docs/PRIVATE_AI.md` for asset verification, local layout, lifecycle, benchmark usage, and Windows acceptance testing.

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

The boundary verifier rejects renderer credential/token storage, direct feature network calls, Circle configuration/secrets, legacy API details, new `P2P_*` production usage, legacy Circle paths/header outside the quarantined main-process adapter, direct production Circle preload access outside `DesktopCircleClient`, production use of `MockCircleClient`, shared-service identity/invitation-secret fields in the public Circle contract or production Circle renderer code, private Vault/Story/AI internals in production renderer/public-contract code, direct Vault preload access outside `DesktopVaultClient`, direct Private AI preload access outside `DesktopPrivateAiClient`, and renderer dependencies on local AI HTTP ports/model/process technicals.

`VaultRagSecurity.test.ts` is merge-blocking and covers cross-user selected-ID rejection, SQLite chunk ownership isolation, absence of Circle/cloud paths, no query-time document re-embedding, explicit-only model downloads, Nomic-only indexing, lazy runtime construction, and upload/extraction independence from AI state. `PrivateArchiveQueryService.test.ts` covers the shared top-three budget, Story/Vault ranking, direct-answer short-circuit, multilingual planning, translated complex routing, local fast/complex Qwen budgets, and safe source projection.

The optional developer benchmark is intentionally outside `npm run check` and CI:

```bash
node scripts/benchmark-private-ai.mjs --fixtures ./private-ai-benchmark-fixtures.json --model both
```

It requires an already-running local Qwen llama.cpp endpoint and accepts loopback addresses only.

## Product boundary

Private/local responsibilities stay on the desktop: the copied SQLite database, protected session state, the local active-Circle preference, Vault/document data, My Story answers/history/media, persisted chunks/embeddings, local Private AI/retrieval, voice, and backup/restore as those slices are migrated.

Shared family responsibilities remain server-owned: Circles, memberships, invitations, relationships, shared tree state, notifications, and deliberately shared profile/content data.

This slice includes the minimum protected shared writes for Circle creation, invitation delivery/management, member removal, and leaving a Circle, plus the private local Vault, My Story, and optional Private AI retrieval. Still excluded:

- Circle rename
- Circle delete
- ownership transfer
- relationship mutations
- tree placeholder mutations
- tree/node-position mutations
- secure `/v2` migration
- automatic sharing of private Story/Vault content

Those can be added as separate protected slices without widening the renderer trust boundary. Circle settings and Family Tree editing remain later shared-state slices; private Vault + My Story + local retrieval remain independent of Circle authorization and content transport.