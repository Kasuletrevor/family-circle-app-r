# Agentic Services, second slice: My Guardian Angels

Date: 2026-10-20
Status: design approved in conversation; spec awaiting review
Builds on: `docs/superpowers/specs/2026-10-16-agentic-services-design.md` (v0.16.0)

## Goal

People can see and manage their own Guardian Angels natively in Family Circle:
connect their Kin-Keepers.ai account, see their angels, add one from a template
with one click and remove one. Settings and testing stay on kin-keepers.ai,
opened in the existing secure in-app view.

**No family data is sent to Kin-Keepers.ai in this slice.** Activating an angel
on family data is still waiting on the privacy decision and an activation API.

## Two parts, two repositories

1. **Backend (agent-ai-landing, built by the backend owner with Codex):** a
   "Connect Family Circle" sign-in that issues separate, limited, revocable app
   credentials, plus one privacy fix. The contract below is the only thing the
   two sides share.
2. **App (this repo):** the connection, the My Guardian Angels tab and the
   "Add to my Guardian Angels" button.

The backend changes only add endpoints and fields, so the website keeps
working unchanged. Release order: backend first, then the app release.

## Backend contract

All addresses are on `https://kin-keepers.ai` (website) and
`https://agentback.kin-keepers.ai` (API). JSON bodies, UTF-8.

### 1. Connect page (website)

`GET https://kin-keepers.ai/connect?client=family-circle&code_challenge=<C>&code_challenge_method=S256&state=<S>`

- `C` is `BASE64URL(SHA256(verifier))` without padding (PKCE S256). `S` is
  22–64 URL-safe characters.
- If the person is not signed in, the page sends them through the normal
  sign-in and returns to `/connect` with all four parameters intact.
- When signed in it shows the account email, what Family Circle will be able
  to do ("see, add and remove your Guardian Angels") and two buttons:
  **Connect Family Circle** and **Cancel**.
- **Connect** calls the authorize endpoint (below), then does a **full page
  navigation** (`window.location.assign`, not a client-side router push) to
  `https://kin-keepers.ai/connect/done?code=<code>&state=<S>`.
- **Cancel** navigates the same way to
  `https://kin-keepers.ai/connect/done?error=access_denied&state=<S>`.
- `/connect/done` just shows "You can return to Family Circle." The app reads
  the address before the page renders.
- Missing or invalid parameters show an error and never issue a code.

### 2. `POST /api/auth/app/authorize`

- Requires the normal website `Authorization: Bearer <website access token>`.
  App tokens are refused here.
- Body: `{ "client": "family-circle", "code_challenge": C, "code_challenge_method": "S256" }`
- 200: `{ "code": "<at least 32 random bytes, base64url>", "expires_in": 60 }`
- The server stores only a hash of the code with the user, the challenge and
  the expiry. A code works once.
- 400 `{ "error": "invalid_request" }` for an unknown client, a method other
  than S256 or a malformed challenge.

### 3. `POST /api/auth/app/token`

Exchanging a code:

- Body: `{ "grant_type": "authorization_code", "client": "family-circle", "code": "...", "code_verifier": "..." }`
- The code is consumed atomically. Two exchanges racing for one code mean at
  most one succeeds.
- Fails with 400 `{ "error": "invalid_grant" }` when the code is unknown,
  expired or already used, or when `BASE64URL(SHA256(code_verifier))` does not
  match.

Refreshing:

- Body: `{ "grant_type": "refresh_token", "client": "family-circle", "refresh_token": "..." }`
- Every refresh returns a **new** refresh token and invalidates the old one.
- If a refresh token that was already replaced is used again, the whole app
  session is revoked and the request fails with `invalid_grant`.

Both grants return 200:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "bearer",
  "expires_in": 900,
  "scope": "angels",
  "user": { "email": "person@example.com", "name": "Person" }
}
```

- Access tokens last 15 minutes and carry the app session id. Refresh tokens
  last 7 days and are stored only as hashes.
- Every request with an app token checks that its session is not revoked.

### 4. `POST /api/auth/app/revoke`

- Body: `{ "client": "family-circle", "refresh_token": "..." }`
- Revokes the app session. Afterwards its access tokens and refresh token stop
  working.
- Always returns 200 `{ "revoked": true }`, including for unknown tokens.
- The website's `/api/auth/logout` is unchanged.

### 5. What an app token may do (scope `angels`)

App tokens are **refused by default**. The existing `get_current_user`
dependency rejects them with 403 `{ "detail": "app_token_not_allowed" }`. A
separate dependency accepts them only on these endpoints:

| Endpoint | With an app token |
| --- | --- |
| `GET /api/auth/me` | as today |
| `GET /api/agno/agents` | only the caller's own agents, **even for admin accounts** |
| `GET /api/agno/agents/{id}` | own agents, or public ones |
| `POST /api/agno/agents/{id}/clone` | as today (public agents only) |
| `DELETE /api/agno/agents/{id}` | own agents only; admin powers never apply |

An admin's app token never carries admin powers. Refresh keeps the same scope.

### 6. Changes to existing responses

- **Privacy:** `GET /api/agno/agents/public` and `GET /api/agno/agents/public/{id}`
  no longer include `created_by` (or return a display name instead of the
  email). The app does not read it from the public list.
- **Execution backend:** list and detail responses gain
  `"execution_backend": "ollama" | "openai"`, from the backend's existing
  `_infer_execution_backend_from_model`. The app labels angels that use cloud
  AI with it.

### 7. Backend regression tests (pytest)

The backend's tests cover:

- **Codes:** expiry; replay; a wrong verifier; two concurrent redemptions with
  one winner; an unknown client.
- **Refresh:** rotation; reuse detection revoking the session.
- **Revocation:** access and refresh tokens stop working after revoke.
- **Scope:** an app token is refused on every other route, both by a
  route-table test and by spot checks.
- **Admins and other users:** an admin's app token lists and deletes only its
  own agents, and a user can't reach another user's private agents.
- **Privacy:** the public list has no `created_by` email.

### Existing endpoints the app uses unchanged

- `POST /api/agno/agents/{id}/clone` returns `cloned_agent` (full agent) with
  `original_agent_id`.
- List fields used: `id, name, description, category, model,
  execution_backend, avatar_src, original_agent_id, is_cloned, run_count,
  last_run_at, trust_boundaries, escalation_triggers, created_by`.
- Website pages opened in the secure view: `/agents/{id}/edit` (settings) and
  `/agents/{id}/run` (testing).

## App design

### What people see

The Guardian Angel page gets two tabs: **Templates** (today's catalog) and
**My Guardian Angels**.

**My Guardian Angels, not connected:** a short explanation ("Connect your
Kin-Keepers.ai account to see and manage your Guardian Angels. Family Circle
shares nothing about your family.") and a **Connect Kin-Keepers.ai** button.

**Connecting:** the secure Guardian Angel view opens at the connect page. If
the person is already signed in to kin-keepers.ai in that view, it is one click
on **Connect Family Circle**. When the view reaches `/connect/done`, Family
Circle returns to the My Guardian Angels tab.

- Cancel shows "Not connected" and leaves things as they were.
- Any failure shows "Couldn't connect. Try again." with a Retry button.

**Connected:** "Connected as person@example.com" with **Disconnect**, then one
card per angel:

- avatar, name, description and "Based on <template name>" when it came from
  a template;
- a **Uses cloud AI (OpenAI)** badge when `execution_backend` is `openai`;
  "Runs on Kin-Keepers servers" otherwise;
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

- **Starting a connection:** `begin()` makes a 32-byte random `verifier` and a
  16-byte random `state`, then returns the connect URL built from them. Only
  one attempt is pending at a time, and a new `begin()` replaces the old one.
  The attempt expires after 10 minutes.
- **Finishing it:** `complete(url)` is called with a `/connect/done` address.
  It checks `state` against the pending attempt, then exchanges the code at
  `/api/auth/app/token`. It keeps the tokens and user email **in memory only**
  and clears the pending attempt whatever the outcome. A wrong or missing
  `state` is ignored.
- **Access tokens:** `accessToken()` returns a token that is still valid.
  Within 60 seconds of expiry it refreshes first, and concurrent callers share
  one refresh. If the refresh fails with `invalid_grant`, it forgets
  everything and reports `disconnected`.
- **Disconnecting:** `disconnect()` forgets the tokens straight away, then
  calls `/api/auth/app/revoke` as a best effort with a 5-second timeout.
- **No secrets cross IPC.** The verifier, code and tokens never reach the
  renderer or any log.
- **Not persisted in this slice:** after restarting the app, Connect is one
  click, because the web view's own sign-in persists in its partition. Storing
  the refresh token with Electron `safeStorage` is a later step.

**Catching `/connect/done`:**

- The Guardian Angel view's host reports navigations to
  `https://kin-keepers.ai/connect/done`. It watches `will-navigate`,
  `will-redirect` and `did-navigate-in-page`, the last one in case the site
  ever uses a client-side push.
- The address goes to `complete()` and the view returns to the template
  start page.
- Only the exact origin and path count. Anything else follows the existing
  navigation rules.

**`MyGuardianAngels`** (`src/main/agentic/MyGuardianAngels.ts`) talks to the
API with an app token:

- **Limits:** the same `download` limits as the catalog (10 s timeout over the
  whole body, a 2 MiB cap, `redirect: 'error'`, `credentials: 'omit'`).
- **Listing:**
  - Calls `GET /api/agno/agents` and keeps only angels whose `created_by`
    equals the connected email, as defense in depth.
  - Sanitizes each one into the safe `MyGuardianAngel` shape and caps the list
    at 100.
  - Avatars come from the catalog's already-downloaded template avatars (by
    `original_agent_id`), otherwise the default avatar. No new image downloads.
- **Adding:** the template ID must be digits only. Calls
  `POST /api/agno/agents/{id}/clone` and returns the sanitized
  `cloned_agent`.
- **Removing:**
  - The ID must be digits only.
  - First calls `GET /api/agno/agents/{id}` and checks that `created_by`
    equals the connected email, then calls `DELETE`. The server enforces this
    too; the app's check keeps it from deleting something unexpected.
  - A 404 at either step counts as already removed.
- **Expired access:** on a 401 it refreshes once and retries once. A second
  401 means disconnected.
- **Sanitizing:**
  - Text is trimmed and capped (name 120, description 600 characters).
  - Safety rules use the existing humanizer from `catalogSanitizer.ts`.
  - Dates must parse.
  - Unknown fields are dropped.

**Shared types** (`src/shared/agentic.ts`):

```ts
interface MyGuardianAngel {
  id: string                   // digits only
  name: string
  description: string
  category: string | null
  templateId: string | null    // original_agent_id
  templateName: string | null  // from the catalog, when known
  avatar: string | null        // data URL from the catalog
  usesCloudAi: boolean         // execution_backend === 'openai'
  runCount: number
  lastRunAt: string | null     // ISO
  safetyRules: string[]
}

type AngelConnection = { status: 'disconnected' } | { status: 'connected'; email: string }

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
- `agentic:connect`: calls `begin()` and opens the Guardian Angel view at the
  connect URL. The renderer then shows that view (target kind `connect`).
- `agentic:disconnect`
- `agentic:my-angels`
- `agentic:add-angel` with the template ID
- `agentic:remove-angel` with the angel ID
- event `agentic:angel-connection-changed`, sent after connect, disconnect or
  expiry.

The preload sanitizes every argument and result as it does for the catalog.
`DesktopAgenticClient` stays the only renderer module that uses the bridge.

**Family Circle sign-out:** the existing `onSignedOut` hook also calls
`disconnect()` on the account's connection. Switching Family Circle accounts
uses that account's own connection.

### Renderer

- **`GuardianAngelPage`:** a tab switcher (Templates / My Guardian Angels) kept
  in the URL as `?tab=mine`. It also gets the add button on template cards.
- **`MyGuardianAngelsPanel`:** shows the connect state and the angel cards,
  and holds the remove confirmation. It uses the existing dialog pattern, so
  `useOverlayOpen` hides any partner view while the dialog is open.
- **`PartnerViewPage`:** target kind `connect` (it shows the view only; the
  URL is built in main). It also accepts `angel=<id>&page=edit|run`.
- **Styles:** `agentic.css` gains the tab and card styles and keeps to the
  green Command mode tokens.
- **Tests:** `fakeAgenticClient` gains the new methods.

## Testing

**Unit (vitest):**

- **`KinKeepersConnection`:**
  - the challenge matches the verifier (S256);
  - `state` mismatch and missing code are ignored;
  - the pending attempt is cleared after success, failure or cancel;
  - refresh before expiry, and concurrent callers share one refresh;
  - `invalid_grant` disconnects;
  - `disconnect()` forgets the tokens before the revoke call finishes and
    swallows revoke failures;
  - secrets never appear in thrown errors.
- **`MyGuardianAngels`:**
  - other users' agents are filtered out;
  - sanitizing and caps;
  - a non-digit ID is refused before any request;
  - removal checks ownership first, and a mismatch means no DELETE;
  - 404 means already removed;
  - a 401 refreshes and retries once;
  - timeouts and oversized bodies give `unavailable`.
- **Navigation:** only `https://kin-keepers.ai/connect/done` triggers
  `complete()`; look-alike hosts and paths don't.
- **IPC and preload:** the channel list; argument sanitizing; no token-shaped
  string in any result.
- **Renderer:**
  - the not-connected, connected, empty and error states;
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
- disconnect, and check that the revoked token no longer works;
- Family Circle sign-out disconnects.

No accounts are created on the live server without asking.

## Out of scope

- Activating angels on family data, running angels from Family Circle and the
  privacy decision behind them.
- Persisting the connection across restarts.
- Signing in through the system browser (RFC 8252). The server side above
  would not need to change for it; the app would only need a loopback
  redirect.
- Revoking website tokens on website logout.
