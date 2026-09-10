# Kin-Keepers Family Circle Desktop

A clean Electron + React + TypeScript rebuild of the Kin-Keepers Family Circle desktop application. Privileged authentication, shared Circle compatibility, local data, Vault operations, and Private AI stay behind narrow Electron main/preload boundaries; the renderer remains presentation-only.

## Current slice

The app currently includes:

- Electron desktop shell with `contextIsolation: true`, renderer sandboxing, and Node integration disabled.
- Protected local authentication, invitation-aware registration/onboarding, password recovery, and 30-day `safeStorage`-protected sessions.
- Copy-safe migration of the legacy local Family Circle database.
- Real Circle Home, My Circles, active-Circle selection, Circle creation, invitations, members, invitation resend/cancel, member removal, and leaving a Circle.
- A real shared **Family Tree** at `/family-tree`, sourced from the active Circle's authoritative people, relationships, and persisted positions.
- Owner-only supported relationship add/remove, with authorization and relationship-integrity validation repeated in `CircleService` before transport.
- Deterministic SVG Family Tree layout with accessible node/relationship selection, pan, zoom, fit-to-tree, readable relationship labels, and persisted node dragging.
- Circle owners may reposition any confirmed member; non-owner members may persist only their own confirmed node position.
- A private local Vault at `/vault` for PDF, DOCX, and TXT upload, validation, duplicate detection, randomized private storage, extraction, retry, open, and deletion.
- Optional local Private AI setup with verified resumable model/runtime downloads.
- Persistent Nomic embeddings and real **Ask your Vault** at `/ai`, with owned-vector retrieval and local Granite generation only.
- Windows x64 NSIS installer packaging with package verification and GitHub Actions artifacts.
- Automated type, test, architecture-boundary, production-build, Windows-package, security-regression, and dependency-audit gates.

Stories, Memories, and Upcoming items remain absent until their real source slices are implemented; the app does not fabricate them.

Still deliberately deferred: Circle rename/delete, ownership transfer, direct tree-placeholder create/edit/delete, and the future secure `/v2` Circle API migration.

## Desktop architecture

```text
React UI
   ↓
typed renderer clients
   ├── DesktopAuthClient
   ├── DesktopCircleClient
   ├── DesktopVaultClient
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
   │       ├── Family Tree relationship integrity
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
   └── Private local AI/RAG
           ├── OfflineAiAssetService
           ├── AiRuntimeManager
           ├── VaultIndexService + VaultChunkRepository
           ├── NomicClient
           ├── VaultQueryService
           └── GraniteClient
```

`DesktopCircleClient` is the only production renderer adapter for Circle reads and writes. React does not call Circle URLs directly and does not receive the compatibility API key, raw shared-service identities, invitation IDs/tokens, or temporary passwords.

`DesktopVaultClient` is the only production renderer adapter for Vault operations and grounded Vault questions. `DesktopPrivateAiClient` is the only production renderer adapter for AI setup/status/progress. React never receives Vault storage paths, SHA-256 values, full extracted text, local-user IDs, embedding vectors/BLOBs, model paths, local model ports, or AI process details.

## Shared identity and active Circle

Local Family Circle user IDs and shared Circle-service user IDs are not assumed to match. `CircleService` restores the protected local session, resolves the persisted `server_user_id`, and derives trusted caller identity in main before shared reads or writes.

The selected Circle is a local viewer preference stored as `active_circle_id`. Before selection or mutation, membership/ownership is checked against authoritative shared state. A stale active-Circle preference is repaired or cleared rather than treated as authorization.

The renderer never supplies trusted values such as `serverUserId`, `ownerId`, `circleId` for active-tree mutations, or target shared-service user IDs.

## Circle reads and management

The public Circle preload surface is deliberately narrow:

```text
circle.getOverview()
circle.getMyCircles()
circle.getCircleDetails()
circle.selectCircle(circleId)
circle.createCircle({ name })
circle.inviteMember({ circleId, email, role })
circle.addTreeRelation({ kind, aPersonId, bPersonId })
circle.deleteTreeRelation({ relationId })
circle.saveTreePosition({ personId, x, y })
circle.resendInvitation({ personId })
circle.cancelInvitation({ personId })
circle.removeMember({ personId })
circle.leaveCircle()
```

IPC reconstructs accepted business inputs field-by-field. Extra renderer-supplied identity, transport, path, or secret-shaped fields are ignored/rejected rather than forwarded.

### Invitations and membership

Invitation roles are descriptive family metadata only:

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

`Circle owner` is authorization state, not an invitation relationship label. Invitation-role labels never infer or automatically create Family Tree relationships.

Owner/member authorization is repeated in main for invitation management, member removal, leaving a Circle, and Family Tree writes. Destructive UI operations wait for confirmed remote success and reload authoritative state instead of optimistically removing records.

## Family Tree

`/family-tree` uses the active Circle's shared tree as its single source of truth. There is **no Family Tree SQLite schema** and no second local copy of shared relationships.

The v1 relationship kinds are exactly:

```text
mother
father
guardian
grandparent
spouse
sibling
aunt_uncle
cousin
```

New relationship writes accept confirmed Circle members only. Legacy placeholder relatives may still render read-only, while pending invitations are excluded from the canvas and represented only through pending-invitation counts.

Before an owner relationship write reaches the compatibility adapter, main-process validation rejects:

- unknown relationship kinds;
- self-relations;
- people outside the active Circle;
- placeholder/invitation mutation endpoints;
- duplicate symmetric or directed relationships;
- ancestry cycles.

Symmetric relationships are canonicalized so reversed spouse/sibling/cousin pairs cannot create duplicates. Historical malformed/cyclic data is tolerated by read/layout code without hanging.

### Layout and interaction

The Family Tree renderer uses pure deterministic layout helpers plus SVG rather than introducing a graph library. Automatic layout assigns generations from family relationships, keeps connected relatives together where inferable, and still places disconnected nodes. Valid persisted positions override automatic coordinates.

The canvas supports:

- node and relationship selection with textual/ARIA state, not color alone;
- pan and zoom;
- an accessible **Fit family tree** control;
- owner relationship add/remove workflows;
- confirmed destructive relation deletion;
- one persisted position write after a completed drag rather than continuous writes while moving.

Position coordinates must be finite and remain within `TREE_COORDINATE_LIMIT` (`100_000`). Main authorization allows a Circle owner to move any confirmed member and a non-owner member to move only their own confirmed node. Failed persistence restores the prior visible position and surfaces a safe user-facing error.

After relationship mutations the renderer reloads the authoritative Circle tree; it does not treat optimistic relationship state as canonical.

## Private local Vault

Vault ownership comes from the restored protected local user, independently of Circle membership. Public operations are:

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

The main process owns the native file picker and all source/destination path resolution. PDF, DOCX, and TXT files are validated locally with a 50 MiB per-document limit. Exact-byte duplicates are detected per user using local SHA-256; same-name files with different bytes are retained as separate display-name versions.

Extraction is local and does not require AI. Parser failures retain the private source so extraction can be retried. Open/retry/query/delete always re-resolve document ownership from the protected session.

## Private AI and local Vault RAG

Private AI is optional and explicitly user-triggered. The public setup states are:

```text
not_installed
downloading
paused
verifying
ready
repair_required
failed
```

The app does not silently download the model/runtime stack at startup, sign-in, or upload. Configured assets must pass expected size/SHA verification before `ready`.

Indexing uses Nomic only. Extraction-ready text is chunked deterministically, embedded with the `search_document: ` prefix, and persisted locally as Float32 embedding BLOBs. Asking a question creates one `search_query: ` embedding, ranks already-persisted owned chunks with cosine similarity, and sends only retrieved context to local Granite. Documents are not re-embedded on every question.

There is no cloud fallback and no Vault-content path through the Circle adapter. See [`docs/PRIVATE_AI.md`](docs/PRIVATE_AI.md) for runtime details and clean-machine acceptance.

## Windows installer

Windows x64 builds use a one-click per-user NSIS installer named:

```text
Family-Circle-Setup-${version}.exe
```

GitHub Releases are the canonical public download source. Branch/PR package runs also upload the installer as a GitHub Actions artifact for verification.

The standard installer does not bundle Private AI models/runtime, `.env` files, Vault data, or user data. See [`docs/WINDOWS_RELEASE.md`](docs/WINDOWS_RELEASE.md) for the release and clean-machine procedure.

## Copy-safe legacy database import

The rebuild owns its active SQLite database under Electron user data. If no active database exists and the legacy database exists at `%APPDATA%/Family Circle/family.db`, startup copies the legacy file first and applies additive migrations only to the copy. The original legacy file is never opened for migration writes. If source and destination resolve to the same canonical file, migration aborts.

## Protected sessions

Successful sign-in stores only a small session envelope containing local user ID, session version, and expiry. It is encrypted with Electron `safeStorage`. There is no plaintext persistent-session fallback. Password changes/resets increment `session_version`, invalidating older sessions.

## Circle compatibility boundary

Current compatibility requests and the legacy API-key header remain quarantined in:

```text
src/main/circle/LegacyCircleAuthAdapter.ts
```

Main-process runtime configuration uses:

```text
CIRCLE_API_URL
CIRCLE_API_KEY
```

Do not add new `P2P_SERVER` or `P2P_API_KEY` usage. The compatibility key is never exposed to React.

## Password recovery email configuration

Email delivery is enabled only when `SEND_EMAILS=true`. Supported configuration names include:

```text
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_TIMEOUT_MS
MAIL_USER
EMAIL_PASS
FROM_EMAIL
```

Compatibility fallbacks remain in the mailer for the older `MAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_TIMEOUT_MS`, `EMAIL_USER`, and `MAIL_PASS` names.

Never commit Circle keys, SMTP passwords, recovery credentials, or other secrets into the repository, renderer assets, or public environment files.

## Local development

Requirements: Node.js 24 and npm.

```bash
npm ci
npm run dev
```

For integration with the shared Circle service, configure the required main-process environment values. Private AI requires no cloud AI credential.

## Verification

Run the complete local gate:

```bash
npm run check
npm audit --audit-level=high
```

`npm run check` performs renderer/Electron TypeScript checks, Vitest, architecture-boundary verification, and Electron/Vite production builds.

The architecture verifier prohibits renderer credential/token storage, direct feature network calls, Circle secrets/legacy transport details outside the main adapter, shared identity fields in public Circle contracts, direct preload use outside dedicated clients, private Vault/AI internals in renderer/public code, and dependencies on local AI ports/model/process details.

`FamilyTreeSecurity.test.ts` is merge-blocking for Family Tree authorization and isolation. `VaultRagSecurity.test.ts` remains merge-blocking for private Vault/RAG ownership and lifecycle invariants.

## Product boundary

Private/local responsibilities remain on the desktop: local SQLite, protected sessions, active-Circle viewer preference, Vault data, persisted embeddings, local Private AI/RAG, and future personal-local slices.

Shared family responsibilities remain server-owned: Circles, memberships, invitations, relationships, shared Family Tree state/positions, notifications, and deliberately shared family content.

This slice includes protected shared writes for Circle creation, invitation management, member removal, leaving a Circle, Family Tree relationship add/remove, and authorized tree-node positioning.

Still excluded:

- Circle rename;
- Circle delete;
- ownership transfer;
- direct tree-placeholder create/edit/delete;
- secure `/v2` migration.

Family Tree v1 deliberately stops at confirmed-member relationship editing plus read-only rendering of existing legacy placeholders. Those deferred capabilities can be added later without widening the renderer trust boundary.