# My Guardian Angels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect a Kin-Keepers.ai account to Family Circle with PKCE, and let
people list, add and remove their own Guardian Angels natively.

**Architecture:**

- **Main process:** `KinKeepersConnection` runs the PKCE flow and holds the
  app tokens in memory, with one refresh at a time. `MyGuardianAngels` calls
  the angel API with those tokens. `angelsController` ties both to the
  signed-in Family Circle account and to the Guardian Angel view, which catches
  `/connect/done`.
- **Boundary:** new `agentic:` IPC channels and preload sanitizers carry only
  safe shapes to the renderer.
- **Renderer:** a tab on the Guardian Angel page, plus connect and angel pages
  in the secure view.

**Tech Stack:** Electron 44 (`WebContentsView`), React 19, react-router 7,
Vitest 4, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-20-my-guardian-angels-design.md`.
**Backend contract:**
`agent-ai-landing/docs/superpowers/specs/2026-10-20-family-circle-connect-design.md`.

## Global Constraints

- **Addresses:** website `https://kin-keepers.ai`, API
  `https://agentback.kin-keepers.ai`.
- **Connect URL:** `https://kin-keepers.ai/connect?app=family-circle&challenge=<43 chars>`.
  It finishes at exactly `https://kin-keepers.ai/connect/done?code=<code>`.
- **Endpoints:**
  - exchange: `POST /api/auth/app/token {code, verifier}`;
  - refresh: `POST /api/auth/app/refresh {refresh_token}`;
  - sign-out: `POST /api/auth/logout {refresh_token}`, plus Bearer while the
    access token is valid.
- **Refresh rules:** one at a time; any refresh failure, including a network
  failure, disconnects and never resends the token.
- **Secrets:** tokens, codes and verifiers live in main memory only and never
  cross IPC or reach logs.
- **Request limits:** every request has `credentials: 'omit'`,
  `redirect: 'error'`, a timeout over the whole body and a size cap.
- **IDs:** template and angel IDs must match `TEMPLATE_ID`
  (`/^[1-9][0-9]{0,9}$/`).
- **Styling:** text is at least 13px and uses the existing `--kk-*` tokens.
- **Boundary:** only `DesktopAgenticClient` may use `window.familyCircle.agentic`.
- **Release:** do not merge until the backend is deployed. Merging publishes a
  release.

## Test commands

```bash
N=/c/Users/kasul/AppData/Local/npm-cache/_npx/387698761821791d/node_modules/node/bin/node.exe
timeout 300 $N node_modules/vitest/vitest.mjs run <files>
npm run -s typecheck && node scripts/verify-boundaries.mjs && npm run -s build
```

Each new test must first be shown failing without the implementation.

---

### Task 1: Shared types and validators

**Files:**

- Modify: `src/shared/agentic.ts`
- Test: `src/shared/agentic.angels.test.ts`

**Produces:**

- Types:
  - `AngelPage = 'edit' | 'run'`;
  - `PartnerViewTarget` gains `{ kind: 'angel'; angelId; page }`;
  - `MyGuardianAngel { id, name, description, templateId, templateName,
    avatar, usesCloudAi, runCount, lastRunAt, trustBoundaries,
    escalationTriggers }`;
  - `AngelConnection` (`disconnected` with an optional problem of
    `connect-failed` or `ended`, `connecting`, or `connected` with `email`);
  - `MyAngelsResult`, `AddAngelResult` and `RemoveAngelResult`.
- Functions: `isMyGuardianAngel`, `publicAngel` and `safeAngelConnection`.

**Tests:**

- Valid angels pass; a bad ID, empty name, foreign avatar, negative or
  fractional run count, bad date or bad template ID fails.
- `publicAngel` drops extra fields.
- `safeAngelConnection` keeps only known statuses, problems and valid emails.

### Task 2: `limitedRequest`, shared with the catalog

**Files:**

- Create: `src/main/agentic/limitedRequest.ts`
- Test: `src/main/agentic/limitedRequest.test.ts`
- Modify: `GuardianAngelCatalog.ts` (`download` uses it)

**Produces:**
`limitedRequest(fetch, url, init, { maxBytes, timeoutMs }): Promise<{ status, type, bytes }>`.
It returns error statuses with their body instead of throwing, and throws on a
network failure, a timeout or a body over the size cap.

**Tests:**

- The status, type and body come back, with credentials and redirects forced
  off.
- An empty body is fine.
- Size caps work both when announced and while streaming.
- A body that stalls after the headers times out.
- The existing catalog tests still pass.

### Task 3: `KinKeepersConnection`

**Files:**

- Create: `src/main/agentic/KinKeepersConnection.ts`
- Test: `src/main/agentic/KinKeepersConnection.test.ts`

**Produces:**

- Exports: `KIN_KEEPERS_SITE`, `KIN_KEEPERS_API`, `pkceChallenge(verifier)` and
  `connectDoneCode(url): string | null`.
- The class `KinKeepersConnection({ fetch, onChange, now?, timeoutMs?, randomBytes? })`
  with:
  - `status()`, `begin(): string`, `cancel()` and
    `complete(code): Promise<boolean>`;
  - `accessToken({ rejected? }): Promise<string | null>`;
  - `disconnect(problem?: 'ended')` and `useAccount(key)`.

**Tests:**

- **PKCE:** the RFC 7636 vector; the connect URL's shape and challenge
  length; the verifier never appears in the URL.
- **Exchange:** the body is exactly `{code, verifier}`, and the result is
  connected with the email.
- **Pending attempt:**
  - a code with no attempt is ignored;
  - the attempt is dropped after failure (connect-failed), cancel or expiry;
  - a late exchange after disconnect is ignored and its tokens revoked.
- **`connectDoneCode`:** look-alike hosts, paths, protocols and credentials
  are rejected.
- **Refresh:**
  - concurrent callers trigger exactly one refresh;
  - a rejected token forces a refresh;
  - a network failure disconnects as `ended`, with one refresh request and a
    logout that carries the refresh token;
  - `invalid_grant` and `refresh_token_reuse` end the connection.
- **Disconnect:** it forgets the tokens before logout finishes and swallows
  logout failures.
- **Accounts:** switching account disconnects.
- **Secrets:** no secret appears in emitted states.

### Task 4: Angel sanitizer and `MyGuardianAngels`

**Files:**

- Create: `src/main/agentic/angelSanitizer.ts` and `MyGuardianAngels.ts`
- Tests for both
- Modify: `catalogSanitizer.ts` to export `cleanText`, `rules` and `catalogId`

**Produces:**

- `sanitizeAngel(raw, templates)` and `sanitizeAngels(raw, templates)`, which
  returns null when the response is not a list.
- The class `MyGuardianAngels({ fetch, connection, templates, timeoutMs? })`
  with `list()`, `add(templateId)` and `remove(angelId)`.

**Tests:**

- **Cloud AI:** `execution_backend` decides first, then the model rule
  (`gpt-`, `o1`, `o3`).
- **Dates:** UTC times without a zone are read as UTC.
- **Shape:** extra fields are dropped; the list is capped at 100 and deduped.
- **Listing:** sends the Bearer token; takes the avatar and name from the
  template.
- **Tokens:** no token means disconnected with no request; a 401 refreshes
  and retries once; a second 401 means `disconnect('ended')`.
- **Failures:** a network failure, a 500 or bad JSON means unavailable.
- **Adding:** posts to `/clone`; 403 and 404 mean not-found; a bad ID makes
  no request.
- **Removing:** 2xx and 404 mean removed, 403 means not-yours, a bad ID makes
  no request.

### Task 5: Partner views — angel pages, connect page and catching `/connect/done`

**Files:**

- Modify: `partnerServices.ts` (angel `targetUrl`), `PartnerViews.ts`
  (`openPage`, `interceptNavigation`), `electronPartnerViewHost.ts`
  (an `intercept` parameter)
- Tests: `partnerServices.test.ts`, `PartnerViews.test.ts`

**Produces:**

- `PartnerViewsHost.createView(service, partition, onStatus, intercept)`.
- `PartnerViews.openPage(service, url)`.
- An optional `interceptNavigation(service, url): boolean` dependency. When it
  takes a navigation, the view returns to its start page.

**Tests:**

- Angel URLs are built correctly, and bad IDs or pages are refused.
- `openPage` refuses other hosts.
- A taken navigation returns the view to the start page; a declined one
  doesn't.

### Task 6: `angelsController` and IPC channels

**Files:**

- Create: `src/main/agentic/angelsController.ts` (+ test)
- Modify: `agenticIpc.ts` (+ test)

**Produces:**

- `createAngelsController({ connection, angels, openPage, accountKey })`,
  covering `connection`, `connect`, `cancelConnect`, `disconnect`, `list`,
  `add`, `remove` and `interceptNavigation`.
- IPC channels: `agentic:angel-connection`, `agentic:connect`,
  `agentic:cancel-connect`, `agentic:disconnect`, `agentic:my-angels`,
  `agentic:add-angel` and `agentic:remove-angel`.
- The angel target is accepted in `agentic:open-view`.

**Tests:**

- Connect uses the signed-in account and opens the connect page.
- When signed out, connect throws, and list, add and remove report
  disconnected.
- Only the Guardian Angel view's `/connect/done` is taken.
- IPC validates IDs and returns only public fields.

### Task 7: main.ts wiring

- One `KinKeepersConnection` sends `agentic:angel-connection-changed` to the
  window.
- The catalog is shared with `MyGuardianAngels` for template avatars and names.
- `PartnerViews` gets `interceptNavigation`.
- Sign-out also calls `disconnect()`.
- The account-key helper is shared.

### Task 8: Preload, DesktopApi type, renderer clients and fake

**Files:**

- `src/shared/desktopApi.ts` and `src/preload/createDesktopApi.ts`
  (+ agentic test)
- `AgenticClient.ts`, `DesktopAgenticClient.ts` and `fakeAgenticClient.ts`

**Produces:** the renderer methods `getAngelConnection`, `connect`,
`cancelConnect`, `disconnect`, `getMyAngels`, `addAngel`, `removeAngel` and
`onAngelConnection`.

**Tests:**

- Fixed channels, carrying only IDs.
- Invalid angels are filtered out.
- Unknown results become safe defaults.
- Connection events pass through the safe shape.
- The angel view target is passed through cleanly.

### Task 9: Guardian Angel page: tabs, the add button and My Guardian Angels panel

**Files:**

- Create: `cardParts.tsx` (`CardAvatar`, `SafetyRules`), `angelMessages.ts`
  and `MyGuardianAngelsPanel.tsx`
- Modify: `GuardianAngelPage.tsx` and `agentic.css`
- Test: `GuardianAngelPage.angels.test.tsx`

**Tests:**

- **Tabs:** switching tabs; connecting from the tab; the "ended" message.
- **Connected list:** the cloud badge, runs and "Based on"; Settings opens in
  the view; the empty state goes back to Templates.
- **Removing:** asks first, then reloads the list.
- **Other actions:** Disconnect; Retry when Kin-Keepers.ai is unreachable; the
  list loads after a connection event.
- **Adding:**
  - adds once per burst of clicks;
  - when not connected, it connects first, carrying `add=`;
  - a pending add finishes after connecting.

### Task 10: PartnerViewPage — the connect page and angel pages

**Files:**

- Modify: `PartnerViewPage.tsx`
- Test: `PartnerViewPage.connect.test.tsx`

**Tests:**

- The connect page opens without a target and shows Cancel. Cancel calls
  `cancelConnect` and returns to the tab.
- Connecting returns to the tab, carrying `add`; a failure returns without it.
- An angel page opens the angel target, with a link back to My Guardian
  Angels.

### Task 11: Verify, real-app check, spec touch-ups and PR

- **Full checks:** the whole test suite, typecheck, boundaries and build.
- **Real app (isolated profile, nothing to deploy):**
  - The My Guardian Angels tab shows Connect. Connect opens
    `kin-keepers.ai/connect?...` in the view, and Cancel returns.
  - Forcing `location.assign('https://kin-keepers.ai/connect/done?code=…')`
    inside the view is cancelled and shows "Couldn't connect". The exchange
    fails until the backend is live.
- **Spec touch-ups:** the `problem` field, separate trust and escalation lists
  in place of `safetyRules`, and no `category`.
- **PR:** open it and leave it unmerged until the backend is live.
