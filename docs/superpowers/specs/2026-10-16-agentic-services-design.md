# Agentic Services, first slice: catalog and secure views

Date: 2026-10-16
Status: approved design, awaiting spec review

## Goal

Bring the Kin-Keepers agentic world into Family Circle as a separate, green
**COMMAND mode**. In this first slice people can browse the Guardian Angel
templates natively and open the partner services (Guardian Angel templates,
UberCare, Marketplace) inside the app in isolated, sandboxed web views. People
sign in and activate templates on kin-keepers.ai itself.

**No family data leaves the computer in this slice.** Running templates with
family data needs a privacy decision and an activation API from Jose/Marvin and
is a later slice.

## What people see

### Mode switch

- A new sidebar group, **Agentic Services**, with three entries:
  Guardian Angel (`/agentic/guardian-angel`), UberCare (`/agentic/ubercare`)
  and Marketplace (`/agentic/marketplace`).
- While any `/agentic/*` route is open the whole frame turns green and the top
  bar shows a **COMMAND MODE** badge. Any core page returns to blue Ask mode.
- Green is applied by overriding the role-based accent tokens
  (`--kk-accent*`) under `[data-mode="command"]` on the app root:
  accent `#15803d`, sidebar background `#0f3d2c`. Gold `#e6ad69` is unchanged.
  Text sizes and contrast follow the existing rules (min 13 px, WCAG AA).

### Guardian Angel page (native)

- Curated templates only, grouped by category, with a search box (name and
  description).
- Category labels: Elder companion, Care coordinator, Family update,
  After a visit, Medication and appointments. Unknown categories go under
  "Other".
- Each card: avatar, name, description, and **Safety rules**: the trust
  boundaries and escalation triggers written as plain sentences.
- **Use this template** opens `https://kin-keepers.ai/templates/{id}` in the
  Guardian Angel secure view.
- Page actions: **Sign in to Kin-Keepers.ai** and **Care Builder**
  (`https://kin-keepers.ai/care-builder`), both in the same secure view.
- States: loading; ready; offline with a saved copy ("Showing the copy from
  {date}" + Retry); no copy ("Couldn't reach Guardian Angel" + Retry); no
  search matches.

### Partner view page (shared)

Used for UberCare (`https://remotecarers.net/worker/`), Marketplace
(`https://kin-keepers.ai/`) and Guardian Angel template pages.

- Header bar: Back, service name, Reload, **Open in browser**, and the note
  "Partner service. Family Circle shares nothing with it."
- The web view fills the rest of the content area.
- Load failure: "Couldn't open {service}" with Retry and Open in browser.
- Leaving the page hides the web view; returning shows it again with its page
  and sign-in kept.

## Technical design

### Main process

**`GuardianAngelCatalog`** (`src/main/agentic/GuardianAngelCatalog.ts`)

- Fetches `GET https://agentback.kin-keepers.ai/api/agno/agents/public` over
  HTTPS with a 10 s timeout, no credentials, no cookies.
- Keeps entries with `is_curated === true` and maps each to a strict shape:

  ```ts
  interface GuardianAngelTemplate {
    id: string                    // validated: [A-Za-z0-9_-]{1,64}
    name: string                  // trimmed, max 120 chars
    description: string           // trimmed, max 600 chars
    category: string              // known key or 'other'
    trustBoundaries: string[]     // max 12 items, 200 chars each
    escalationTriggers: string[]  // max 12 items, 200 chars each
    avatar: string | null         // data:image/png|jpeg|webp;base64,... or null
  }
  ```

  Everything else (`created_by`, model, tools, slug, internal fields) is
  dropped. Entries that fail validation are skipped, not fatal.
- Avatars: `avatar_src` must be a path on `https://kin-keepers.ai`; each is
  downloaded once (size cap 512 KB, image content types only) and returned as
  a data URL, so the renderer never loads remote content. Failed avatars fall
  back to initials.
- The last good result is saved atomically to `userData/agentic/catalog.json`
  with its fetch time. On failure the saved copy is returned with
  `stale: true`; with no copy an `unavailable` result is returned.
- Result: `{ status: 'ready', templates, fetchedAt, stale } | { status: 'unavailable' }`.
- The network call is injected so the class is unit-testable.

**`PartnerViews`** (`src/main/agentic/PartnerViews.ts`)

- Fixed service table (the renderer names a key, never a URL):

  | key | start URL | allowed hosts | partition |
  |---|---|---|---|
  | `guardian-angel` | `https://kin-keepers.ai/` | `kin-keepers.ai`, `www.kin-keepers.ai` | `persist:agentic-kin-keepers` |
  | `ubercare` | `https://remotecarers.net/worker/` | `remotecarers.net`, `www.remotecarers.net` | `persist:agentic-ubercare` |
  | `marketplace` | `https://kin-keepers.ai/` | `kin-keepers.ai`, `www.kin-keepers.ai` | `persist:agentic-kin-keepers` (shared, one sign-in) |

- One `WebContentsView` per service, created on first open and attached to the
  main window's content view. `webPreferences`: no preload, sandbox,
  contextIsolation, no nodeIntegration, webSecurity, own partition.
- Security rules on each view:
  - `will-navigate` / `will-redirect` to a non-allowed host or a non-HTTPS URL
    is cancelled; HTTPS URLs are opened with `shell.openExternal`, anything
    else is dropped.
  - `setWindowOpenHandler` always denies; allowed-host HTTPS links load in the
    same view, other HTTPS links go to the system browser.
  - Permission requests (camera, microphone, notifications, geolocation and
    others) are denied via the partition's `setPermissionRequestHandler`.
  - Downloads are cancelled.
- Template pages: `openTemplate(id)` validates the id and loads
  `https://kin-keepers.ai/templates/{id}` in the Guardian Angel view.
- The renderer reports the view's rectangle (integers, clamped to the window)
  and shows or hides it. Only one view is visible at a time. Views are
  destroyed when the window closes or the user signs out.
- Load state (`loading`, `ready`, `failed`) and `canGoBack` are sent to the
  renderer as events.
- The navigation decision is a pure function (`decideNavigation(service, url)`)
  so it can be tested without Electron.

**IPC** (all inputs validated in the handler)

- `agentic:catalog` `{ refresh?: boolean }` returns the catalog result.
- `agentic:open-view` `{ service, templateId? }`.
- `agentic:set-view-bounds` `{ service, x, y, width, height }`.
- `agentic:hide-view` `{ service }`.
- `agentic:view-command` `{ service, command: 'back' | 'reload' | 'open-external' }`.
- Event `agentic:view-state` `{ service, state, canGoBack }`.

### Preload and renderer

- Preload exposes `window.familyCircle.agentic.*`; only
  `src/renderer/services/agentic/DesktopAgenticClient.ts` touches it (boundary
  rule checked by `scripts/verify-boundaries.mjs`). An `AgenticClient`
  interface and `MockAgenticClient` back the tests and the preview harness.
- Routes: `/agentic/guardian-angel` shows `GuardianAngelPage`;
  `/agentic/ubercare`, `/agentic/marketplace` and
  `/agentic/guardian-angel/view` show `PartnerViewPage`.
- `PartnerViewPage` measures its view slot with `ResizeObserver` (plus window
  resize) and sends bounds; it hides the view on unmount.
- `App` sets `data-mode="command"` on the app root when the path starts with
  `/agentic/`; `Sidebar` gains the Agentic Services group; `TopBar` shows the
  badge.
- Menus and dialogs cannot draw above a `WebContentsView`, so while a partner
  view is visible the app hides it when a modal or the top-bar menu opens and
  shows it again after.

## Error handling

- Catalog fetch errors, timeouts, bad JSON and invalid entries never throw to
  the renderer; they become `stale` or `unavailable` results.
- Partner view load failures (`did-fail-load`, main frame only) become the
  `failed` state; Retry reloads the last URL.
- Invalid IPC input is rejected without side effects.

## Testing

- Catalog: curated filter; `created_by`, model and tools never in the output;
  field caps; invalid entries skipped; avatar host and size checks; cache
  write and offline fallback; `unavailable` without a copy.
- Navigation: allowed hosts; `http:` refused; look-alike hosts
  (`kin-keepers.ai.evil.test`) refused; external links routed to the browser;
  template id validation.
- IPC: unknown service keys, bad bounds and bad ids rejected.
- Renderer: green mode on `/agentic/*` and blue elsewhere; sidebar group;
  catalog states (loading, ready, stale, unavailable, search, no matches);
  "Use this template" opens the view; partner view header actions; view
  hidden on leave.
- New tests are shown to fail on the old code before the change.
- Real app check in an isolated profile: open each service, confirm the green
  frame, the sign-in page loads, external links go to the browser and the view
  follows window resizing.

## Out of scope

- Sending any family data to templates or partners.
- Activating templates from Family Circle (needs an API from Jose/Marvin).
- Bio-Metrics, SLEDSS and ElderChat integrations.
