# Kin-Keepers Family Circle Desktop

A clean Electron + React + TypeScript rebuild of the Kin-Keepers Family Circle desktop application.

This branch establishes the secure desktop shell and polished Home experience before any production Circle API integration.

## Current foundation

- Electron desktop shell with `contextIsolation`, renderer sandboxing, and Node integration disabled.
- React + TypeScript renderer with routed desktop navigation.
- Kin-Keepers design system and bundled official logo at `public/kin-cropped.jpg`.
- Typed `CircleClient` application boundary with a local `MockCircleClient`.
- Home overview with family metrics, events, activity, tree preview, member details, and local-AI status.
- Loading, failure, and retry states.
- Automated renderer-boundary checks that prevent direct production API coupling and secret leakage.

## Local development

Requirements:

- Node.js 24
- npm

Install dependencies:

```bash
npm ci
```

Start the desktop development environment:

```bash
npm run dev
```

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
```

## Architecture boundary

The renderer currently uses local typed services only. It must not contain production Circle secrets, legacy `window.KK` coupling, direct feature-level network calls, or embedded production Circle API URLs.

Production API integration should replace the injected `CircleClient` implementation rather than bypassing the service boundary.

## Status

The current implementation is intentionally backend-isolated. Jose's production Circle APIs are not connected in this slice.
