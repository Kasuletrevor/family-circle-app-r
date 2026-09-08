# Windows Packaging and Release Design

## Goal

Ship the rebuilt Family Circle desktop app as a downloadable Windows x64 installer and establish a repeatable release path that preserves the rebuild's privacy/security boundaries.

The normal installer must stay small: it packages the Electron app, compiled renderer/main/preload code, public assets, and `config/offline-ai-manifest.json`, but it does **not** bundle Granite, Nomic, llama.cpp, Vault data, `.env`, SMTP credentials, Circle API credentials, or any user data.

## Reference Pattern

The reference Family Circle repo used `electron-builder` with an NSIS Windows target and emitted `Family-Circle-Setup-${version}.exe`. CI built the installer on `windows-latest`, verified that an installer existed, uploaded it to a GitHub Release, then optionally mirrored release assets to `/var/www/family-circle/electron-releases` with `current.json`, `versions.json`, `VERSION`, and a `latest` symlink.

This rebuild keeps the useful parts of that design while removing the old practice of bundling `.env` into the installer.

## Scope

### In scope

1. Add production Electron packaging with `electron-builder`.
2. Create a Windows x64 NSIS installer named `Family-Circle-Setup-${version}.exe`.
3. Reuse the existing Family Circle `.ico` branding from the reference repo.
4. Package only the runtime files needed by the rebuilt app.
5. Include `config/offline-ai-manifest.json` so Private AI can be installed after app installation.
6. Add a packaging verifier that fails if required packaged files are missing or if forbidden secrets/model assets are included.
7. Add a Windows GitHub Actions packaging workflow that proves the `.exe` is produced.
8. Upload the installer as a GitHub Actions artifact for every packaging run.
9. On a version tag (`v*`), create/update a GitHub Release and attach the installer.
10. Document the local Windows build and clean-machine smoke test.
11. Preserve the option to mirror releases to the existing Family Circle server in a later follow-up without making server credentials a prerequisite for the first downloadable release.

### Out of scope

- Bundling the ~2 GB Private AI model/runtime payload into the normal installer.
- Auto-updating the Electron app.
- Windows code signing or EV/OV certificate procurement.
- Redesigning Circle API authentication.
- Shipping SMTP credentials or enabling desktop SMTP by default.
- Linux/macOS packaging in this feature.
- Server-side release mirroring until the required deployment secrets are confirmed.

## Architecture

```text
source tree
   |
   +-- npm run check
   |
   +-- npm run package:win
           |
           +-- build:electron
           +-- build:renderer
           +-- electron-builder --win nsis --x64
           |
           v
   release/Family-Circle-Setup-<version>.exe
           |
           +-- verify installer exists
           +-- upload Actions artifact
           +-- on tag v*: attach to GitHub Release
```

Private AI remains progressive-download:

```text
small installer
   |
   +-- app code
   +-- offline-ai-manifest.json
   |
   +-- user explicitly clicks Set up Private AI
           |
           +-- downloads llama.cpp + Granite + Nomic
           +-- verifies size + SHA256
           +-- stores assets under Electron userData
```

## Packaging Configuration

Use `electron-builder` as a development dependency.

Package identity:

- `appId`: `com.kinkeepers.familycircle`
- `productName`: `Family Circle`
- Windows architecture: `x64`
- Windows target: `nsis`
- artifact name: `Family-Circle-Setup-${version}.exe`
- installer mode: one-click per-user install
- desktop shortcut: yes
- Start Menu shortcut: yes
- uninstall must preserve app data by default

Packaging output goes to `release/` so it does not collide with the existing compiled-code `dist/` directory.

Packaged application files:

- `dist/main/**/*`
- `dist/preload/**/*`
- `dist/shared/**/*` when emitted
- `dist/renderer/**/*`
- `config/offline-ai-manifest.json`
- `package.json`
- production `node_modules` resolved by electron-builder
- `build/family-circle.ico`

Explicitly excluded:

- source TypeScript
- tests
- docs
- `.github`
- `.env*`
- `*.gguf`
- `*.bin` model files
- `bin/`
- `models/`
- local databases and `.family-circle-data/`
- `release/`
- credentials/secrets

## Runtime Paths

The existing application code already loads:

- preload from `dist/preload/preload.js`
- renderer from `dist/renderer/index.html`
- AI manifest from `join(app.getAppPath(), 'config', 'offline-ai-manifest.json')`

The packaging layout must preserve those paths inside the packaged application.

`app.getPath('userData')` remains the root for the SQLite database, Vault files, protected session state, and downloaded Private AI assets. None of those are packaged.

## Configuration and Secrets

The installer must not contain `.env` or secret values.

Current runtime rules remain:

- `CIRCLE_API_URL` may be absent because `LegacyCircleAuthAdapter` has the existing production endpoint as its internal default.
- `CIRCLE_API_KEY` is optional at process level. If the legacy backend requires a shared key, that is a backend/client-auth migration concern; packaging must not disguise a shared desktop key as a secret by embedding it into the installer.
- SMTP remains disabled unless `SEND_EMAILS=true` and runtime SMTP configuration is supplied externally.

The release workflow must not echo secret values and must not bake GitHub Actions secrets into packaged resources.

## Packaging Verification

Create a deterministic Node verifier that checks the electron-builder configuration and/or unpacked package output for the following invariants:

1. Product name is `Family Circle`.
2. NSIS x64 target is configured.
3. Artifact name is `Family-Circle-Setup-${version}.exe`.
4. `dist/main/main.js` is included.
5. `dist/preload/preload.js` is included.
6. `dist/renderer/index.html` is included.
7. `config/offline-ai-manifest.json` is included.
8. `.env`, `.env.*`, `*.gguf`, model directories, or Private AI binaries are not packaged.
9. Installer output exists after a Windows packaging run.

A failed invariant must fail CI.

## GitHub Actions

Create a dedicated `windows-package.yml` workflow.

Triggers:

- `workflow_dispatch`
- pull requests that modify packaging/release files
- pushes to `feature/windows-packaging-release`
- version tags matching `v*`

Windows build job:

1. checkout
2. setup Node 24
3. `npm ci --no-audit`
4. `npm run check`
5. `npm run package:win`
6. `npm run verify:package`
7. locate exactly one `Family-Circle-Setup-*.exe`
8. upload installer as a GitHub Actions artifact

Release step on `v*` only:

- use the repository `GITHUB_TOKEN` with `contents: write`
- create or reuse the matching GitHub Release
- upload the `.exe` with clobber/replace semantics

GitHub Releases are the canonical public download source for this feature. This ensures the rebuilt app becomes downloadable without depending on SSH/server secrets.

## Versioning

The current package version is `0.1.0`.

The first release produced by this feature should therefore be `v0.1.0` unless the branch changes the package version before release.

A later release automation feature may add release-please. It is intentionally not required for the first installer because version-tag-driven releases have fewer moving parts and are easier to verify end-to-end.

## Code Signing

The first installer may be unsigned. Windows SmartScreen may warn users because the executable has no trusted publisher reputation.

The workflow must be structured so code signing can be added later without redesigning packaging. Signing certificate/private-key work is out of scope for this feature.

## Clean-Machine Acceptance Test

On a Windows 10/11 x64 machine or clean Windows VM:

1. Download `Family-Circle-Setup-0.1.0.exe` from the GitHub Release.
2. Confirm the installer starts and completes.
3. Launch Family Circle from the desktop or Start Menu shortcut.
4. Confirm the app window renders without a dev server.
5. Confirm app version reports `0.1.0`.
6. Confirm `%APPDATA%`/Electron userData is created only after first launch.
7. Upload a TXT document without setting up Private AI; confirm upload/extraction works and the document is `waiting_for_ai`.
8. Confirm the Private AI card offers explicit setup and shows the expected total download size.
9. Start Private AI setup; confirm progress is friendly and no model URL/path/hash is exposed in the renderer.
10. After setup, confirm indexing completes and `/ai` can answer from the uploaded document.
11. Disconnect the network after setup and confirm Vault Q&A still works locally.
12. Uninstall Family Circle and confirm user data is not automatically deleted.

## Release Acceptance Criteria

The feature is complete only when all of the following are true on the exact final branch head:

- existing full `npm run check` passes
- `npm audit --audit-level=high` passes
- packaging verifier passes
- Windows CI produces exactly one NSIS `.exe`
- the installer is uploaded as a workflow artifact
- a `v0.1.0` tag build successfully publishes the same installer to a GitHub Release
- the GitHub Release asset is downloadable
- clean-machine smoke test instructions are documented
- no `.env`, Private AI model, model hash/path technicals, or user data are bundled into the installer
