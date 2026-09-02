# Family Circle Rebuild — Design Specification

Date: 2026-09-02
Status: Proposed for implementation

## Goal

Rebuild the Kin-Keepers Family Circle Windows desktop application so the core product remains familiar while the experience becomes cleaner, safer, easier to maintain, and easier to extend.

The existing Family Circle application is the behavioral reference. We preserve useful workflows and product intent, but we do not preserve fragile implementation patterns merely for compatibility.

## Product principles

1. **Same core product, better execution.** Existing Family Circle workflows remain recognizable and functionally equivalent unless deliberately improved.
2. **Windows desktop first.** The product remains an Electron application for Windows.
3. **Private by default.** My Story, Vault documents, embeddings, local AI state, and voice data remain local to the desktop unless a future feature explicitly introduces sharing.
4. **Shared family state is server-owned.** Circles, memberships, invitations, relationships, shared family-tree structure, and shared notifications are managed by the Circle API and shared database.
5. **Do not break Jose's existing APIs during the rebuild.** Existing endpoints stay available while the new application talks to them through compatibility adapters.
6. **Secure migration, not a big-bang rewrite.** New `/v2` endpoints can be added alongside the current API and adopted progressively.
7. **Brand continuity.** The desktop app uses the Kin-Keepers visual identity from `Elder-ChatGPT/agent-ai-landing`, including the official Kin-Keepers logo and established navy/teal/gold palette.

## Technology direction

### Desktop shell

- Electron on a currently supported release line.
- Electron main process owns privileged desktop capabilities.
- `contextIsolation: true`.
- `nodeIntegration: false` in the renderer.
- A narrow, typed preload bridge exposes only approved operations.

### Renderer

- React + TypeScript.
- Feature-oriented components rather than giant HTML/JS pages.
- Shared design-system components for buttons, dialogs, cards, inputs, navigation, states, and alerts.
- Route-level feature separation.

### Local application layer

Owns:

- local user/session integration where needed during migration,
- SQLite access,
- Vault/document storage,
- My Story,
- local media,
- local embeddings,
- llama.cpp / Granite runtime,
- Whisper/offline voice runtime,
- local backup/restore,
- OS-backed secret protection.

### Shared API layer

Owns:

- shared users,
- circles,
- memberships,
- invitations,
- relationships,
- family-tree shared structure,
- notifications,
- shared profile data deliberately intended for other circle members.

## Architecture

```text
                 FAMILY CIRCLE WINDOWS APP
                          Electron
                             |
           +-----------------+-----------------+
           |                                   |
      RENDERER                            MAIN PROCESS
 React + TypeScript                    privileged desktop
           |                                   |
           |                            +-------+--------+
           |                            |       |        |
           |                          Files   SQLite   Offline AI
           |                                           llama.cpp
           |                                           Whisper
           |
           v
    Application Services
           |
    +------+---------------+
    |      |               |
 Auth   Circle         Biometrics
Client  Client           Client
    |      |               |
    +------+-------+-------+
                   |
             API adapters
                   |
       +-----------+------------+
       |                        |
 CURRENT JOSE APIs        NEW /v2 APIs
 kept working              added gradually
       |                        |
       +-----------+------------+
                   |
               PostgreSQL
```

## Compatibility layer

Renderer components must not call raw URLs directly.

For example, UI code calls:

```ts
circleService.getMyCircles()
circleService.createCircle()
circleService.inviteMember()
circleService.getFamilyTree()
circleService.addRelationship()
circleService.leaveCircle()
```

The implementation initially maps those operations to the existing API contract, such as:

```text
GET  /api/me/{userId}/groups
POST /api/group/create
POST /api/group/invite-email
GET  /api/group/{groupId}/tree/{userId}
```

Later, the same client interface can map to secure `/v2` endpoints without requiring screen rewrites.

## Authentication migration

The existing `P2P_API_KEY` is treated only as a temporary compatibility mechanism for existing API calls.

The rebuilt application must not treat a bundled application-wide API key as permanent user identity.

The target `/v2` model is:

```text
user signs in
    -> server verifies identity
    -> server issues user-specific session/token
    -> server derives authenticated user from that session
    -> authorization checks membership/ownership server-side
```

The server must not trust `fromUserId` or similar caller-supplied identity as proof of who is acting.

Historical `P2P_*` naming should be retired in new code:

```text
P2P_SERVER          -> CIRCLE_API_URL
p2pClient           -> circleClient
start-p2p-server    -> start-circle-api
localCircleServer   -> circleApi
sharedCircleDb      -> circleRepository
```

Existing names can remain inside compatibility code until the old application is retired.

## Private vs shared data boundary

### Local/private

- My Story
- Vault documents
- extracted document text
- embeddings
- local AI model/runtime
- voice recordings and local speech processing
- private local media
- local backups

### Shared/server

- circles
- circle members
- invitations
- member roles
- family relationships
- shared family-tree topology
- shared notifications/activity

Shared profile photos should become an explicit product decision rather than being accidentally local or shared. The initial rebuild can preserve existing behavior while the API contract is clarified.

## Branding and visual system

Source of truth: `Elder-ChatGPT/agent-ai-landing`.

### Brand assets

Primary logo source:

```text
frontend/public/kin-cropped.jpg
```

Additional available brand asset:

```text
frontend/public/kin-keepers-logo.png
```

The rebuild should copy the chosen official asset into its own application assets rather than hot-linking to another repository.

### Core palette

```text
Deep navy      #0C2348
Ocean blue     #0C557F
Primary teal   #0E9F9A
Dark teal      #0C6F70
Warm gold      #E6AD69
Soft mint      #E9FBF6
Cool tint      #EEF2F7
Canvas         #F7F9FB
Card           #FFFFFF
```

Use navy for structure and primary typography, teal for interactive states and primary actions, and gold sparingly for distinctive Kin-Keepers accents/status emphasis.

The desktop UI should be calmer than the marketing website while remaining unmistakably part of the same product family.

## Initial application navigation

The first shell uses a persistent left navigation appropriate for a Windows desktop app:

```text
Home
My Circles
Family Tree
Members
Invitations
Stories
Vault
Memories
AI Assistant
Settings
```

The navigation can be refined as individual feature designs are completed. Core routes should have stable names from the beginning.

## Initial home experience

The first rebuilt home shell should establish the product's visual and architectural foundation rather than implement every feature immediately.

It should include:

- Kin-Keepers brand area,
- active Circle selector,
- user/session control,
- notification affordance,
- lightweight search shell,
- local/offline AI status,
- summary cards,
- recent activity placeholder/state,
- upcoming family events placeholder/state,
- family-tree preview area,
- selected-member details panel.

During the first implementation slice, these areas may use typed mock data where a clean service contract has not yet been wired to the existing API.

## UI implementation rules

1. No giant page files equivalent to the current `index.html` or `mystory.html`.
2. No new `window.KK`-style global application state.
3. No raw `fetch()` calls from feature components.
4. No secrets exposed through renderer configuration.
5. No arbitrary privileged IPC surface. Every preload operation must have a clear domain and typed payload/result.
6. Avoid unsafe HTML rendering; user-controlled data should render as text unless explicitly sanitized.
7. Loading, empty, error, offline, and permission-denied states are first-class UI states.
8. Keyboard navigation and accessible labels are part of component acceptance criteria.

## Suggested renderer structure

```text
src/
  main/
  preload/
  renderer/
    app/
    components/
    design-system/
    features/
      auth/
      home/
      circles/
      family-tree/
      members/
      invitations/
      stories/
      vault/
      memories/
      ai/
      biometrics/
      settings/
    services/
      auth/
      circle/
      biometrics/
    state/
    types/
  local/
    database/
    documents/
    ai/
    voice/
    security/
```

Exact paths may be adjusted to fit the chosen build tooling, but the feature boundaries should remain.

## API evolution

### Stage 1

```text
New Electron UI -> new typed clients -> existing Jose APIs
```

### Stage 2

Introduce `/v2` endpoints for identity-sensitive shared operations while keeping `/api/...` working for the existing application.

```text
Old app -> /api/...
New app -> mixture of /api/... and /v2/...
```

### Stage 3

Move the rebuilt client fully to `/v2`, remove dependence on the shared application key, then retire old endpoints only after the existing application is no longer required.

## Security priorities

Before public release of the rebuilt application:

1. Replace application-wide shared API-key identity with per-user server-verified sessions.
2. Move secrets to OS-backed storage or server-side ownership as appropriate.
3. Verify biometrics/cognitive endpoints require appropriate authenticated and authorized access.
4. Review all renderer-to-main IPC boundaries.
5. Encrypt or otherwise appropriately protect sensitive local data at rest where the product/security requirements demand it.
6. Run dependency and Electron hardening reviews on the supported release line.

These security tasks can be implemented progressively, but compatibility code must remain clearly identified as transitional.

## Testing strategy

The current application is an executable behavioral reference.

For each migrated feature:

1. Document the old behavior.
2. Add acceptance tests for the behavior that must remain.
3. Implement the new feature behind the new service interface.
4. Compare old vs new flows.
5. Switch to the new implementation.
6. Remove obsolete code only after the replacement passes acceptance tests.

The first shell should include automated checks for:

- application boot,
- route/navigation rendering,
- preload bridge availability,
- design-system rendering,
- offline/online service-state presentation,
- no direct network dependency required merely to open the app shell.

## First implementation slice

The first code milestone is intentionally narrow:

1. Scaffold Electron + React + TypeScript in `Kasuletrevor/family-circle-app-r`.
2. Add the official Kin-Keepers logo asset from `Elder-ChatGPT/agent-ai-landing`.
3. Add brand design tokens.
4. Create the Windows desktop shell and navigation.
5. Create the Home route based on the approved Family Circle mockup direction.
6. Add typed service/client interfaces with stub/mock implementations; do not yet duplicate all old API logic.
7. Establish tests/build scripts and commit the lockfile.

This slice deliberately does **not** rewrite Circle authentication, the Circle API, My Story, Vault, AI, or biometrics yet. Those become subsequent bounded migration slices built on the clean shell.

## Out of scope for the first slice

- deleting or changing the existing Family Circle repository,
- replacing Jose's production APIs,
- migrating production databases,
- changing invitation email behavior,
- rewriting the offline AI installer,
- changing biometrics providers,
- true peer-to-peer networking,
- mobile/web product variants.

## Success criteria for the first slice

The repository can build and launch a Windows-oriented Electron development app that:

- uses React + TypeScript,
- displays the Kin-Keepers logo and approved palette,
- has the approved navigation shell,
- has a polished Home screen foundation,
- starts without the existing backend being available,
- contains no server-wide API key in renderer-visible configuration,
- provides typed boundaries ready for the existing Circle APIs to be connected next.
