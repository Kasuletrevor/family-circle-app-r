# Agentic Services, second slice: My Guardian Angels

Date: 2026-10-20
Status: design approved in conversation; spec awaiting review
Builds on: `docs/superpowers/specs/2026-10-16-agentic-services-design.md` (v0.16.0)
Backend contract: `agent-ai-landing/docs/superpowers/specs/2026-10-20-family-circle-connect-design.md`

## Goal

People can see and manage their own Guardian Angels natively in Family Circle:
connect their Kin-Keepers.ai account, see their angels, add one from a template
with one click and remove one. Settings and testing stay on kin-keepers.ai,
opened in the existing secure in-app view.

**No family data is sent to Kin-Keepers.ai in this slice.** Activating an angel
on family data is still waiting on the privacy decision and an activation API.

## Two parts, two repositories

1. **Backend (agent-ai-landing, owned by Codex):** the Family Circle connection
   (PKCE S256), separate limited and revocable app credentials, a default-deny
   boundary for app tokens, and removing creators' emails from the public list.
   Its spec, linked above, is the source of truth for every request, response
   and error. This document only records what the app relies on.
2. **App (this repo, owned by Claude):** the connection client, the My Guardian
   Angels tab and the "Add to my Guardian Angels" button.

Release order: the backend is deployed and checked in production first, then
the app release that uses it.

## What the app relies on from the backend

The website is at `https://kin-keepers.ai`; the API is at
`https://agentback.kin-keepers.ai`.

**Starting the connection:**

1. The app makes a fresh verifier: 43 base64url characters from 32 random
   bytes. They come from `[A-Za-z0-9_-]`, which falls inside the allowed set.
2. It computes `challenge = BASE64URL(SHA256(ASCII(verifier)))`, without padding.
3. It opens
   `https://kin-keepers.ai/connect?app=family-circle&challenge=<challenge>` in
   the Guardian Angel view.

**Finishing it:**

1. When the person clicks Connect, the site replaces the location with
   `https://kin-keepers.ai/connect/done?code=<code>`.
2. The app catches that exact origin and path, cancels the navigation, and
   posts `{code, verifier}` to `POST /api/auth/app/token`. The code expires
   after 60 seconds.
3. A successful exchange returns
   `{access_token, refresh_token, token_type, expires_in: 900, refresh_expires_in, scope}`.
   It contains no user details.

**Refreshing and signing out:**

- **Refresh:** `POST /api/auth/app/refresh {refresh_token}` returns the same
  shape with a new refresh token. The session ends 7 days after connecting,
  whatever the refreshes.
- **Never send a refresh token twice.** Presenting an already-used refresh
  token revokes the session. So the app sends **one refresh at a time**, and
  after a refresh that fails on the network (where the outcome is unknown) it
  **disconnects** instead of retrying.
- **Sign-out:** `POST /api/auth/logout` with the body `{refresh_token}`, and
  `Authorization: Bearer <app access token>` while that is still valid.

**Errors** come as `{"detail": {"code": ..., "message": ...}}`:

- `invalid_grant` and `invalid_token` mean disconnected.
- `refresh_token_reuse` means disconnected.
- `insufficient_scope` means unavailable; the app never expects it.

**Angel endpoints accepted with an app token:**

- The backend always applies owner-only rules to app tokens, including for
  admin accounts.
- The success responses are the same as today.

| App action | Endpoint | Permission |
| --- | --- | --- |
| List my angels | `GET /api/agno/agents` | `angels:read` (own only) |
| Read one | `GET /api/agno/agents/{id}` | `angels:read` (own only) |
| Add from template | `POST /api/agno/agents/{id}/clone` | `angels:add` (public source) |
| Remove | `DELETE /api/agno/agents/{id}` | `angels:remove` (own only) |

- **List fields used:** `id, name, description, model, avatar_src,
  original_agent_id, run_count, last_run_at, trust_boundaries,
  escalation_triggers`.
- **Clone response:** `{cloned_agent: <full agent>, ...}`.

**Website pages opened in the secure view:** `/agents/{id}/edit` (settings) and
`/agents/{id}/run` (testing).

### Open requests to the backend (the app works without them)

1. **The connected account's email.** The contract returns no user details and
   refuses `/api/auth/me` for app tokens. The app would like either a
   `user: {email, name}` field in the exchange response or `/api/auth/me`
   accepted with `angels:read`.
   - Without it, the app says "Connected to Kin-Keepers.ai" instead of
     "Connected as person@example.com".
2. **Which AI service an angel uses.** An `execution_backend: "ollama" | "openai"`
   field on angel responses would let the app label cloud AI reliably.
   - Without it, the app copies the backend's own rule: a model starting with
     `gpt-`, `o1` or `o3` means OpenAI.

## App design

### What people see

The Guardian Angel page gets two tabs: **Templates** (today's catalog) and
**My Guardian Angels**.

**My Guardian Angels, not connected:** a short explanation ("Connect your
Kin-Keepers.ai account to see and manage your Guardian Angels. Family Circle
shares nothing about your family.") and a **Connect Kin-Keepers.ai** button.

**Connecting:**

- The secure Guardian Angel view opens at the connect page. If the person is
  already signed in to kin-keepers.ai in that view, it is one click on
  **Connect Family Circle**.
- While connecting, the view's bar shows **Cancel**, which drops the attempt
  and returns to the tab.
- When the view reaches `/connect/done`, Family Circle returns to the My
  Guardian Angels tab.
- Any failure shows "Couldn't connect. Try again." with a Retry button.

**Connected:** "Connected as person@example.com" (or "Connected to
Kin-Keepers.ai") with **Disconnect**, then one card per angel:

- avatar, name, description and "Based on <template name>" when it came from
  a template;
- a **Uses cloud AI (OpenAI)** badge for OpenAI models; "Runs on Kin-Keepers
  servers" otherwise;
- runs and last run ("Never run" when 0);
- **Safety rules** collapsed, with the same wording as the template cards;
- **Settings** opens `/agents/{id}/edit` and **Test** opens `/agents/{id}/run`
  in the secure view;
- **Remove** asks first: "Remove <name> from your Guardian Angels? This
  deletes it on Kin-Keepers.ai and can't be undone."

An empty list says "You have no Guardian Angels yet" with a link to the
Templates tab.

**Templates tab:** each template card gains **Add to my Guardian Angels**.

- When connected, it clones the template and shows "Added to My Guardian
  Angels" with a link to the tab. The button is busy until the clone finishes,
  so a double click adds one angel.
- When not connected, it starts the connect flow and then adds the angel.

**Errors in plain words:**

- A connection that expired or was revoked: "Your Kin-Keepers.ai connection
  has ended. Connect again." The app forgets it and shows the Connect button.
- Offline or a server error: "Couldn't reach Kin-Keepers.ai. Check your
  internet connection." with Retry.
- An angel already deleted elsewhere: the card disappears and the list
  refreshes.

### Main process

**`KinKeepersConnection`** (`src/main/agentic/KinKeepersConnection.ts`), one
per signed-in Family Circle account:

- **Starting a connection:** `begin()` makes a verifier as above and returns
  the connect URL. Only one attempt is pending at a time; a new `begin()`
  replaces it, and `cancel()` drops it. An attempt expires after 10 minutes.
- **Finishing it:** `complete(code)` exchanges the code with the pending
  attempt's verifier. It keeps the tokens **in memory only**. It drops the
  pending attempt whatever the outcome, and a code that arrives with no
  pending attempt is ignored.
  - PKCE binds the code to this attempt's verifier, so a code from anywhere
    else fails the exchange.
- **Access tokens:** `accessToken()` returns a valid token. Within 60 seconds
  of expiry it refreshes first.
  - **Refreshes are serialized:** concurrent callers share the one in-flight
    refresh, and no second refresh starts while one is pending.
  - **When a refresh fails:** an error code, a network failure or a timeout
    means the connection forgets everything and reports `disconnected`. It
    never resends a refresh token.
- **Disconnecting:** `disconnect()` forgets the tokens straight away, then
  posts to `/api/auth/logout` as a best effort with a 5-second timeout.
- **Account email:** read from the exchange response or `/api/auth/me` if the
  backend adds either (see the open requests), otherwise `null`.
- **No secrets cross IPC.** The verifier, code and tokens never reach the
  renderer, a URL other than the contract's, or any log.
- **Not persisted in this slice:** after restarting the app, Connect is one
  click, because the web view's own sign-in persists in its partition. Storing
  the refresh token with Electron `safeStorage` is a later step.

**Catching `/connect/done`:**

- The Guardian Angel view's host checks `will-navigate`, `will-redirect` and
  `did-navigate-in-page` for exactly `https://kin-keepers.ai/connect/done`.
  The last one is there in case the site ever uses a client-side push.
- On a match it cancels the navigation where possible, passes the `code`
  parameter to `complete()`, and returns the view to the template start page.
  The code is never shown in the view's address or history.
- Look-alike hosts and paths follow the existing navigation rules.

**`MyGuardianAngels`** (`src/main/agentic/MyGuardianAngels.ts`) talks to the
API with an app token:

- **Limits:** the same `download` limits as the catalog (10 s timeout over the
  whole body, a 2 MiB cap, `redirect: 'error'`, `credentials: 'omit'`).
- **Listing:**
  - Calls `GET /api/agno/agents`, sanitizes each angel into the safe
    `MyGuardianAngel` shape, and caps the list at 100.
  - Ownership is enforced by the server for app tokens.
  - Avatars come from the catalog's already-downloaded template avatars (by
    `original_agent_id`), otherwise the default avatar. No new image downloads.
- **Adding:** the template ID must be digits only. Calls
  `POST /api/agno/agents/{id}/clone` and returns the sanitized `cloned_agent`.
  A 404 means `not-found`.
- **Removing:** the ID must be digits only. Calls `DELETE /api/agno/agents/{id}`.
  - A 404 counts as already removed.
  - A 403 means `not-yours`.
- **Expired access:** on a 401 `invalid_token`, the app gets a fresh token
  (through the serialized refresh) and retries once. A second 401 means
  disconnected.
- **Sanitizing:**
  - Text is trimmed and capped (name 120, description 600 characters).
  - Safety rules use `humanizeRule` from `catalogSanitizer.ts`.
  - Dates must parse.
  - Unknown fields are dropped.

**Shared types** (`src/shared/agentic.ts`):

```ts
interface MyGuardianAngel {
  id: string                   // digits only
  name: string
  description: string
  templateId: string | null    // original_agent_id
  templateName: string | null  // from the catalog, when known
  avatar: string | null        // data URL from the catalog
  usesCloudAi: boolean
  runCount: number
  lastRunAt: string | null     // ISO
  trustBoundaries: string[]    // shown like the template cards
  escalationTriggers: string[]
}

type AngelConnection =
  // problem says why: the connect page failed, or a live connection ended
  | { status: 'disconnected'; problem?: 'connect-failed' | 'ended' }
  | { status: 'connecting' }
  | { status: 'connected'; email: string | null }

type MyAngelsResult =
  | { status: 'ready'; angels: MyGuardianAngel[] }
  | { status: 'disconnected' }
  | { status: 'unavailable' }

type AddAngelResult =
  | { status: 'added'; angel: MyGuardianAngel }
  | { status: 'disconnected' | 'not-found' | 'unavailable' }

type RemoveAngelResult = { status: 'removed' | 'disconnected' | 'not-yours' | 'unavailable' }
```

**IPC channels**, following the existing `agentic:` handlers:

- `agentic:angel-connection`: returns the `AngelConnection`.
- `agentic:connect`: calls `begin()` and loads the connect URL into the
  Guardian Angel view. The renderer shows that view with target kind
  `connect`; the URL itself is built in main.
- `agentic:cancel-connect`
- `agentic:disconnect`
- `agentic:my-angels`
- `agentic:add-angel` with the template ID
- `agentic:remove-angel` with the angel ID
- event `agentic:angel-connection-changed`, sent after connect, cancel,
  disconnect or expiry.

The preload sanitizes every argument and result as it does for the catalog.
`DesktopAgenticClient` stays the only renderer module that uses the bridge.

**Family Circle sign-out:** the existing `onSignedOut` hook also calls
`disconnect()` on the account's connection. Switching Family Circle accounts
uses that account's own connection.

### Renderer

- **`GuardianAngelPage`:** a tab switcher (Templates / My Guardian Angels) kept
  in the URL as `?tab=mine`. It also gets the add button on template cards.
- **`MyGuardianAngelsPanel`:** shows the connection state and the angel cards,
  and holds the remove confirmation. It uses the existing dialog pattern, so
  `useOverlayOpen` hides any partner view while the dialog is open.
- **`PartnerViewPage`:**
  - target kind `connect`, with a Cancel button in its bar;
  - also accepts `angel=<id>&page=edit|run`.
- **Styles:** `agentic.css` gains the tab and card styles and keeps to the
  green Command mode tokens.
- **Tests:** `fakeAgenticClient` gains the new methods.

## Testing

**Unit (vitest):**

- **`KinKeepersConnection`:**
  - the verifier length and alphabet, and the challenge matches S256 (with a
    known vector);
  - a code with no pending attempt is ignored;
  - the attempt is dropped after success, failure, cancel or expiry;
  - refresh runs before expiry, and concurrent callers cause exactly one
    refresh request;
  - a network failure during refresh disconnects without a second request;
  - `invalid_grant`, `invalid_token` and `refresh_token_reuse` disconnect;
  - `disconnect()` forgets the tokens before logout finishes and swallows
    logout failures;
  - secrets never appear in thrown errors.
- **`MyGuardianAngels`:**
  - sanitizing and caps;
  - a non-digit ID is refused before any request;
  - 404 and 403 on remove;
  - a 401 refreshes and retries once;
  - timeouts and oversized bodies give `unavailable`;
  - the OpenAI model rule.
- **Navigation:** only `https://kin-keepers.ai/connect/done` reaches
  `complete()`, and look-alike hosts and paths don't. The navigation is
  cancelled.
- **IPC and preload:** the channel list; argument sanitizing; no token-shaped
  string in any result.
- **Renderer:**
  - the not-connected, connecting, connected, empty and error states;
  - add while not connected starts connect;
  - double-click adds once;
  - the remove confirmation;
  - the view stays hidden while the dialog is open;
  - `?tab=mine` routing.
- Each new test is shown to fail without the implementation before it passes.

**Real app (isolated profile):** once the backend is deployed, with a test
account the backend owner provides:

- connect;
- list;
- add from a template;
- open Settings and Test;
- remove;
- disconnect, and check that the revoked session no longer works;
- Family Circle sign-out disconnects.

No accounts are created on the live server without asking.

## Out of scope

- Activating angels on family data, running angels from Family Circle and the
  privacy decision behind them.
- Persisting the connection across restarts.
- Signing in through the system browser (RFC 8252).
- Revoking website tokens on website logout.
