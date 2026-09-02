# Family Circle Desktop Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable Kin-Keepers Family Circle Windows desktop shell with Electron, React, TypeScript, Kin-Keepers branding, stable navigation, typed service boundaries, a polished Home route, and automated security/build checks.

**Architecture:** Electron owns the privileged desktop boundary. The renderer is a React + TypeScript application using hash-based routing so packaged `file://` builds work without a server. Renderer features depend on typed service interfaces; the first slice uses mock implementations and does not call Jose's current APIs yet. A narrow preload bridge exposes only non-sensitive desktop operations.

**Tech Stack:** Electron 44.1.1, React 19.2.7, React DOM 19.2.7, TypeScript 7.0.2, Vite 8.1.x, `@vitejs/plugin-react` 6.1.1, React Router DOM 7.18.3, Lucide React 1.39.0, Vitest 4.1.11, React Testing Library 16.3.3, DOM Testing Library 10.4.1, jest-dom 7.0.1, jsdom 30.0.1, npm with committed `package-lock.json`.

**Spec:** `docs/superpowers/specs/2026-09-02-family-circle-rebuild-design.md`

## Global Constraints

- Windows desktop first; Electron remains the desktop runtime.
- `contextIsolation: true`.
- `nodeIntegration: false` in the renderer.
- The renderer receives no `P2P_API_KEY`, server-wide API key, SMTP credential, database password, or equivalent secret.
- New code uses `CIRCLE_API_URL` / `circleClient` naming rather than `P2P_*` naming.
- No raw `fetch()` calls from feature components.
- No `window.KK`-style global state.
- My Story, Vault documents, embeddings, local AI state, and voice remain local/private by default.
- Shared Circle state remains server-owned, but current Jose APIs are not connected in this first slice.
- The application shell must open without any network or backend dependency.
- Brand palette: navy `#0C2348`, ocean blue `#0C557F`, teal `#0E9F9A`, dark teal `#0C6F70`, gold `#E6AD69`, mint `#E9FBF6`, cool tint `#EEF2F7`, canvas `#F7F9FB`, card `#FFFFFF`.
- Kin-Keepers logo source is `Elder-ChatGPT/agent-ai-landing/frontend/public/kin-cropped.jpg`; the new app stores its own local copy/embedded asset and must not hot-link at runtime.

## Planned File Structure

```text
family-circle-app-r/
  package.json
  package-lock.json
  tsconfig.json
  tsconfig.electron.json
  vite.config.ts
  vitest.config.ts
  scripts/
    dev.mjs
    verify-boundaries.mjs
  src/
    main/
      main.ts
      windowOptions.ts
      windowOptions.test.ts
    preload/
      createDesktopApi.ts
      createDesktopApi.test.ts
      preload.ts
    shared/
      desktopApi.ts
    renderer/
      index.html
      main.tsx
      app/
        App.tsx
        App.test.tsx
        routes.tsx
        services.tsx
      assets/
        kin-logo.svg
      components/
        layout/
          AppShell.tsx
          Sidebar.tsx
          Topbar.tsx
          PlaceholderPage.tsx
      design-system/
        BrandMark.tsx
        Button.tsx
        Card.tsx
        brand.ts
        tokens.css
        base.css
      features/
        home/
          HomePage.tsx
          HomePage.test.tsx
          components/
            ActivityList.tsx
            AiStatusCard.tsx
            FamilyTreePreview.tsx
            MemberDetailsPanel.tsx
            MetricCard.tsx
            UpcomingList.tsx
      services/
        circle/
          CircleClient.ts
          MockCircleClient.ts
          types.ts
          MockCircleClient.test.ts
      test/
        setup.ts
      types/
        global.d.ts
  README.md
```

---

### Task 1: Secure Electron + React Foundation

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `tsconfig.electron.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `scripts/dev.mjs`
- Create: `src/shared/desktopApi.ts`
- Create: `src/main/windowOptions.ts`
- Create: `src/main/windowOptions.test.ts`
- Create: `src/main/main.ts`
- Create: `src/preload/createDesktopApi.ts`
- Create: `src/preload/createDesktopApi.test.ts`
- Create: `src/preload/preload.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/types/global.d.ts`
- Create: `src/renderer/test/setup.ts`

**Interfaces:**
- Produces `DesktopApi`:

```ts
export interface DesktopApi {
  app: {
    getVersion(): Promise<string>
    getPlatform(): Promise<NodeJS.Platform>
  }
}
```

- Produces `createDesktopApi(invoke)` where `invoke(channel)` is the only dependency, making the bridge unit-testable without Electron.
- Produces `createWindowOptions(preloadPath)` returning hardened Electron `BrowserWindowConstructorOptions`.

- [ ] **Step 1: Write failing security-boundary tests**

`src/main/windowOptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createWindowOptions } from './windowOptions'

describe('createWindowOptions', () => {
  it('keeps renderer privileges disabled', () => {
    const options = createWindowOptions('C:/app/preload.js')
    expect(options.webPreferences?.contextIsolation).toBe(true)
    expect(options.webPreferences?.nodeIntegration).toBe(false)
    expect(options.webPreferences?.sandbox).toBe(true)
    expect(options.webPreferences?.preload).toBe('C:/app/preload.js')
  })
})
```

`src/preload/createDesktopApi.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './createDesktopApi'

describe('createDesktopApi', () => {
  it('exposes only approved application metadata calls', async () => {
    const invoke = vi.fn(async (channel: string) => channel === 'app:get-version' ? '0.1.0' : 'win32')
    const api = createDesktopApi(invoke)

    expect(Object.keys(api)).toEqual(['app'])
    expect(Object.keys(api.app)).toEqual(['getVersion', 'getPlatform'])
    expect(JSON.stringify(api).toLowerCase()).not.toContain('api_key')

    await expect(api.app.getVersion()).resolves.toBe('0.1.0')
    await expect(api.app.getPlatform()).resolves.toBe('win32')
  })
})
```

- [ ] **Step 2: Create package/build configuration and install exact dependencies**

Use npm and save exact versions:

```bash
npm install --save-exact electron@44.1.1 react@19.2.7 react-dom@19.2.7 react-router-dom@7.18.3 lucide-react@1.39.0
npm install --save-dev --save-exact typescript@7.0.2 vite@8.1.0 @vitejs/plugin-react@6.1.1 vitest@4.1.11 @testing-library/react@16.3.3 @testing-library/dom@10.4.1 @testing-library/jest-dom@7.0.1 jsdom@30.0.1 @types/node @types/react @types/react-dom
```

`package.json` scripts must be:

```json
{
  "main": "dist/main/main.js",
  "scripts": {
    "dev": "node scripts/dev.mjs",
    "build:electron": "tsc -p tsconfig.electron.json",
    "build:renderer": "vite build",
    "build": "npm run build:electron && npm run build:renderer",
    "typecheck": "tsc --noEmit && tsc -p tsconfig.electron.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "verify:boundaries": "node scripts/verify-boundaries.mjs",
    "check": "npm run typecheck && npm run test && npm run verify:boundaries && npm run build"
  }
}
```

Do not add `package-lock.json` to `.gitignore`; commit it.

- [ ] **Step 3: Run tests and confirm they fail because implementations do not exist**

Run:

```bash
npm test -- src/main/windowOptions.test.ts src/preload/createDesktopApi.test.ts
```

Expected: FAIL with missing module/export errors.

- [ ] **Step 4: Implement the minimum hardened Electron boundary**

`src/main/windowOptions.ts` must return:

```ts
export function createWindowOptions(preloadPath: string): Electron.BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#F7F9FB',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  }
}
```

`src/preload/createDesktopApi.ts` must implement only `app:get-version` and `app:get-platform`. `src/preload/preload.ts` exposes it as `window.familyCircle` through `contextBridge.exposeInMainWorld`.

`src/main/main.ts` must register exactly these two IPC handlers, create the BrowserWindow, load `process.env.VITE_DEV_SERVER_URL` during development or `dist/renderer/index.html` in production, deny unexpected new windows, and call `mainWindow.show()` only after `ready-to-show`.

- [ ] **Step 5: Run foundation tests**

Run:

```bash
npm test -- src/main/windowOptions.test.ts src/preload/createDesktopApi.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit foundation**

```bash
git add package.json package-lock.json tsconfig*.json vite.config.ts vitest.config.ts scripts/dev.mjs src/main src/preload src/shared src/renderer/index.html src/renderer/main.tsx src/renderer/types src/renderer/test
git commit -m "feat: scaffold secure Electron React foundation"
```

---

### Task 2: Kin-Keepers Brand Asset and Design Tokens

**Files:**
- Create: `src/renderer/assets/kin-logo.svg`
- Create: `src/renderer/design-system/brand.ts`
- Create: `src/renderer/design-system/tokens.css`
- Create: `src/renderer/design-system/base.css`
- Create: `src/renderer/design-system/BrandMark.tsx`
- Create: `src/renderer/design-system/BrandMark.test.tsx`
- Modify: `src/renderer/main.tsx`

**Interfaces:**
- Produces `brandTokens` with exact palette values.
- Produces `<BrandMark compact?: boolean />` used by Sidebar and future auth screens.
- `kin-logo.svg` embeds the exact source pixels from `Elder-ChatGPT/agent-ai-landing/frontend/public/kin-cropped.jpg` as a local data URI; no runtime network fetch.

- [ ] **Step 1: Inspect and import the real logo asset**

Fetch the source image from the Elder-ChatGPT repository, visually verify it is the expected Kin-Keepers mark, base64-encode it, and embed it into `src/renderer/assets/kin-logo.svg` using an SVG `<image>` element. The SVG must be committed in this repository and must not reference `github.com` or `raw.githubusercontent.com` at runtime.

- [ ] **Step 2: Write the failing brand component test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandMark } from './BrandMark'

it('renders the Kin-Keepers identity and privacy line', () => {
  render(<BrandMark />)
  expect(screen.getByRole('img', { name: /kin-keepers/i })).toBeInTheDocument()
  expect(screen.getByText('Kin-Keepers')).toBeInTheDocument()
  expect(screen.getByText('Private by design.')).toBeInTheDocument()
})
```

- [ ] **Step 3: Run the test to verify failure**

```bash
npm test -- src/renderer/design-system/BrandMark.test.tsx
```

Expected: FAIL because `BrandMark` does not exist.

- [ ] **Step 4: Implement brand tokens and base styling**

`brand.ts` exports:

```ts
export const brandTokens = {
  navy: '#0C2348',
  ocean: '#0C557F',
  teal: '#0E9F9A',
  tealDark: '#0C6F70',
  gold: '#E6AD69',
  mint: '#E9FBF6',
  coolTint: '#EEF2F7',
  canvas: '#F7F9FB',
  card: '#FFFFFF',
} as const
```

`tokens.css` mirrors those values as CSS custom properties and adds text, border, success, warning, and shadow tokens without introducing another brand hue.

`base.css` defines Inter/system typography, body reset, focus-visible ring in teal, accessible default text colors, and reduced-motion handling.

- [ ] **Step 5: Implement and test BrandMark**

Use the local `kin-logo.svg` image, navy/gold typography, and the exact subtitle `Private by design.`.

Run:

```bash
npm test -- src/renderer/design-system/BrandMark.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit branding**

```bash
git add src/renderer/assets src/renderer/design-system src/renderer/main.tsx
git commit -m "feat: add Kin-Keepers desktop design system"
```

---

### Task 3: Stable Desktop Navigation and Application Shell

**Files:**
- Create: `src/renderer/app/routes.tsx`
- Create: `src/renderer/app/App.tsx`
- Create: `src/renderer/app/App.test.tsx`
- Create: `src/renderer/components/layout/AppShell.tsx`
- Create: `src/renderer/components/layout/Sidebar.tsx`
- Create: `src/renderer/components/layout/Topbar.tsx`
- Create: `src/renderer/components/layout/PlaceholderPage.tsx`
- Create: `src/renderer/components/layout/layout.css`
- Modify: `src/renderer/main.tsx`

**Interfaces:**
- Produces stable route paths: `/`, `/circles`, `/family-tree`, `/members`, `/invitations`, `/stories`, `/vault`, `/memories`, `/ai`, `/settings`.
- Produces `<AppShell />` using React Router `<Outlet />`.
- Uses `HashRouter`/hash routes so packaged `file://` navigation works.

- [ ] **Step 1: Write failing shell/navigation test**

The test renders `App` under `MemoryRouter`, then asserts the navigation contains all ten approved labels and that the Home route is selected by default.

```tsx
expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
expect(screen.getByRole('link', { name: 'My Circles' })).toBeInTheDocument()
expect(screen.getByRole('link', { name: 'Family Tree' })).toBeInTheDocument()
expect(screen.getByRole('link', { name: 'Members' })).toBeInTheDocument()
expect(screen.getByRole('link', { name: 'Invitations' })).toBeInTheDocument()
expect(screen.getByRole('link', { name: 'Stories' })).toBeInTheDocument()
expect(screen.getByRole('link', { name: 'Vault' })).toBeInTheDocument()
expect(screen.getByRole('link', { name: 'Memories' })).toBeInTheDocument()
expect(screen.getByRole('link', { name: 'AI Assistant' })).toBeInTheDocument()
expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
```

- [ ] **Step 2: Run the test and verify failure**

```bash
npm test -- src/renderer/app/App.test.tsx
```

Expected: FAIL because the application shell is not implemented.

- [ ] **Step 3: Implement responsive Windows-oriented shell**

Sidebar: 256px navy column with `BrandMark`, approved nav, teal active state, gold used only for small emphasis/badges, and a bottom local-AI status card.

Topbar: active Circle selector placeholder (`Kasule Family` in mock mode), search field shell, notifications button, and profile/session button. Buttons must have accessible names and keyboard focus styles.

Content: `#F7F9FB` canvas, constrained desktop spacing, no marketing-page hero treatment.

- [ ] **Step 4: Add placeholder pages for non-Home routes**

Each placeholder displays the route title and copy `This feature will be migrated from the current Family Circle application in a later slice.`. No endpoint calls.

- [ ] **Step 5: Run navigation test and typecheck**

```bash
npm test -- src/renderer/app/App.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit shell**

```bash
git add src/renderer/app src/renderer/components/layout src/renderer/main.tsx
git commit -m "feat: add Family Circle desktop navigation shell"
```

---

### Task 4: Typed Circle Service Boundary and Mock Implementation

**Files:**
- Create: `src/renderer/services/circle/types.ts`
- Create: `src/renderer/services/circle/CircleClient.ts`
- Create: `src/renderer/services/circle/MockCircleClient.ts`
- Create: `src/renderer/services/circle/MockCircleClient.test.ts`
- Create: `src/renderer/app/services.tsx`

**Interfaces:**

`types.ts` defines:

```ts
export type ServiceState = 'ready' | 'offline' | 'loading' | 'error'

export interface CircleSummary {
  id: string
  name: string
  memberCount: number
}

export interface FamilyPerson {
  id: string
  name: string
  role?: string
  birthYear?: number
  avatarUrl?: string
  isCurrentUser?: boolean
}

export interface FamilyRelationship {
  id: string
  fromPersonId: string
  toPersonId: string
  kind: string
}

export interface HomeSnapshot {
  activeCircle: CircleSummary
  metrics: {
    members: number
    circles: number
    stories: number
    memories: number
  }
  upcoming: Array<{ id: string; title: string; when: string }>
  activity: Array<{ id: string; title: string; detail: string; when: string }>
  people: FamilyPerson[]
  relationships: FamilyRelationship[]
  selectedPersonId: string
  ai: { state: ServiceState; model: string; mode: 'offline' | 'online' }
}
```

`CircleClient` defines:

```ts
export interface CircleClient {
  getHomeSnapshot(): Promise<HomeSnapshot>
  getMyCircles(): Promise<CircleSummary[]>
}
```

`AppServices` contains `{ circle: CircleClient }` and is injected through React context. Feature components never instantiate a client directly.

- [ ] **Step 1: Write failing MockCircleClient contract test**

Test that `getHomeSnapshot()` returns a Circle named `Kasule Family`, at least four people, one current user, and AI state `ready`/`offline`.

- [ ] **Step 2: Verify failing test**

```bash
npm test -- src/renderer/services/circle/MockCircleClient.test.ts
```

Expected: FAIL because service files do not exist.

- [ ] **Step 3: Implement interfaces and deterministic mock data**

Mock data must be static and local; no `fetch`, timers, network requests, environment URLs, or secrets.

Use sample names only as demonstrative UI data; the service contract, not the sample values, is the important artifact.

- [ ] **Step 4: Add AppServicesProvider**

`useAppServices()` throws a clear error when used outside its provider. Production app startup injects a single `MockCircleClient` instance for this slice.

- [ ] **Step 5: Run service tests**

```bash
npm test -- src/renderer/services/circle/MockCircleClient.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit service boundary**

```bash
git add src/renderer/services src/renderer/app/services.tsx
git commit -m "feat: establish typed Circle service boundary"
```

---

### Task 5: Polished Home Screen Foundation

**Files:**
- Create: `src/renderer/features/home/HomePage.tsx`
- Create: `src/renderer/features/home/HomePage.test.tsx`
- Create: `src/renderer/features/home/home.css`
- Create: `src/renderer/features/home/components/MetricCard.tsx`
- Create: `src/renderer/features/home/components/UpcomingList.tsx`
- Create: `src/renderer/features/home/components/ActivityList.tsx`
- Create: `src/renderer/features/home/components/FamilyTreePreview.tsx`
- Create: `src/renderer/features/home/components/MemberDetailsPanel.tsx`
- Create: `src/renderer/features/home/components/AiStatusCard.tsx`
- Modify: `src/renderer/app/routes.tsx`

**Interfaces:**
- `HomePage` obtains data only through `useAppServices().circle.getHomeSnapshot()`.
- Home owns loading, error, and ready states.
- Presentational children receive typed props and contain no network/service calls.

- [ ] **Step 1: Write failing Home acceptance test**

Test expected behavior rather than DOM structure:

```tsx
expect(await screen.findByText(/good morning/i)).toBeInTheDocument()
expect(screen.getByText('Kasule Family')).toBeInTheDocument()
expect(screen.getByText('Family Tree')).toBeInTheDocument()
expect(screen.getByText('Recent Activity')).toBeInTheDocument()
expect(screen.getByText('Upcoming')).toBeInTheDocument()
expect(screen.getByText('Ready (Offline)')).toBeInTheDocument()
expect(screen.getByRole('region', { name: /selected member/i })).toBeInTheDocument()
```

Also provide a test client whose `getHomeSnapshot()` rejects; assert an accessible error state with a Retry button is rendered.

- [ ] **Step 2: Verify tests fail**

```bash
npm test -- src/renderer/features/home/HomePage.test.tsx
```

Expected: FAIL because `HomePage` is not implemented.

- [ ] **Step 3: Implement Home layout matching approved direction**

Desktop layout:

```text
Greeting + metrics strip

Upcoming      Family Tree Preview       Member Details
Recent        Family Tree Preview       Member Details
Activity
```

Use white cards on the light canvas, navy text, teal active controls, and gold only for distinctive accent/status. Keep shadows subtle. The family-tree preview is visual only in this slice; it renders typed people/relationship data and does not implement dragging yet.

- [ ] **Step 4: Implement first-class loading/error states**

Loading: skeleton/quiet status with `aria-busy="true"`.

Error: card titled `Family Circle could not load` with safe error copy and Retry button.

Ready: full Home layout.

No backend availability check occurs during app boot.

- [ ] **Step 5: Run Home tests and full renderer tests**

```bash
npm test -- src/renderer/features/home/HomePage.test.tsx src/renderer/app/App.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Home**

```bash
git add src/renderer/features/home src/renderer/app/routes.tsx
git commit -m "feat: build polished Family Circle home screen"
```

---

### Task 6: Automated Boundary Verification, Build Check, and Developer README

**Files:**
- Create: `scripts/verify-boundaries.mjs`
- Create: `README.md`
- Modify: `package.json` if the final check command differs from Task 1 after implementation.

**Interfaces:**
- `npm run verify:boundaries` exits non-zero when forbidden patterns appear in renderer source.
- `npm run check` is the acceptance command for this slice.

- [ ] **Step 1: Write the boundary verifier**

The script recursively scans `src/renderer` text files and fails on these patterns:

```text
P2P_API_KEY
X-Kin-Keepers-Key
process.env.P2P_
window.KK
raw.githubusercontent.com/Elder-ChatGPT/agent-ai-landing
https://familycircle.o2gventures.com/circle-api
```

It also fails if a file under `src/renderer/features/` contains the literal `fetch(`. Service implementations may use network calls in later slices, but feature components may not.

The script prints each violating path and pattern, then exits with code 1.

- [ ] **Step 2: Run the verifier**

```bash
npm run verify:boundaries
```

Expected: PASS with `Renderer boundary checks passed.`

- [ ] **Step 3: Write README startup instructions**

README must document:

```bash
npm ci
npm run dev
npm run check
npm run build
```

It must explain that this first slice intentionally uses local mock Circle data, Jose's current APIs remain unchanged, and the next integration slice will implement a compatibility `LegacyCircleClient` behind the same `CircleClient` interface.

- [ ] **Step 4: Run the complete acceptance gate**

```bash
npm ci
npm run check
```

Expected:
- both TypeScript configurations pass,
- all Vitest tests pass,
- boundary verifier passes,
- Electron main/preload compile,
- Vite renderer production build succeeds.

- [ ] **Step 5: Launch development app and perform smoke check**

```bash
npm run dev
```

Verify manually:

1. Electron window opens without a backend/server running.
2. Kin-Keepers logo is local and visible.
3. Sidebar shows all ten routes.
4. Home loads mock data.
5. Navigating to a placeholder route works and returning Home works.
6. DevTools console has no uncaught exceptions.
7. Search/notification/profile controls are present but do not make network calls.
8. Window can be resized down to the configured minimum without content overlap that blocks navigation.

- [ ] **Step 6: Commit verification/docs**

```bash
git add scripts/verify-boundaries.mjs README.md package.json
git commit -m "chore: add desktop shell acceptance checks"
```

---

## Slice Completion Criteria

This plan is complete only when all of the following are true:

- `npm ci` succeeds using committed `package-lock.json`.
- `npm run check` passes from a clean checkout.
- Electron 44 starts the app on Windows-oriented dimensions.
- The renderer has `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- The renderer exposes no server-wide secret/config API key.
- The Kin-Keepers logo is local to this repository and the approved navy/teal/gold palette is used.
- Stable navigation contains Home, My Circles, Family Tree, Members, Invitations, Stories, Vault, Memories, AI Assistant, and Settings.
- Home renders using typed mock service data and works without Jose's APIs.
- Feature components contain no raw `fetch()` calls.
- Circle integration can be added next by implementing `LegacyCircleClient` without rewriting the Home/UI component contract.
