# Windows installer and release procedure

Family Circle is packaged for Windows x64 as a one-click per-user NSIS installer. The normal installer contains the compiled Electron application and `config/offline-ai-manifest.json`; it does not bundle Private AI models/runtime assets, Vault data, `.env` files, SMTP credentials, Circle API credentials, or user data.

GitHub Releases are the canonical public download source. Branch and pull-request packaging runs also upload the installer as a GitHub Actions artifact for verification.

## Local Windows build

Run these commands from PowerShell on Windows with Node.js 24 installed:

```powershell
npm.cmd ci --no-audit
npm.cmd run check
npm.cmd run package:win
npm.cmd run verify:package
```

For package version `0.1.0`, the expected installer is:

```text
release/Family-Circle-Setup-0.1.0.exe
```

`npm run verify:package` checks the packaging identity and boundaries and, when `release/` exists, requires exactly one installer matching the current package version.

## Release workflow

`.github/workflows/windows-package.yml` runs on Windows and performs the following gates:

1. install dependencies with `npm ci --no-audit`
2. run the full `npm run check` quality gate
3. build the Windows x64 NSIS installer
4. run the deterministic package verifier
5. require exactly one `Family-Circle-Setup-*.exe`
6. upload that installer as a GitHub Actions artifact
7. for a `v*` tag only, create/reuse the matching GitHub Release and attach the installer

The first release is `v0.1.0` while `package.json` remains at version `0.1.0`.

## Signing and SmartScreen

The first installer is currently unsigned. Windows SmartScreen may therefore show an unknown-publisher or reputation warning. Code signing can be added later without changing the packaging layout, but signing credentials are not required for this first release.

## Private AI stays progressive-download

Installing Family Circle does not download or bundle the roughly 2 GiB Private AI stack. Upload/storage/extraction work without Private AI. The user must explicitly choose **Set up Private AI** later; the app then downloads the configured llama.cpp runtime, Granite model, and Nomic embedding model, verifies immutable size/SHA-256 metadata in the Electron main process, and stores them beneath Electron `userData`.

The normal installer must never include `.env`, `.env.*`, `*.gguf`, Private AI `models/` or `bin/` payloads, local databases, `.family-circle-data/`, Vault documents, or user data.

## Clean-machine acceptance test

Run this on a clean Windows 10/11 x64 machine or clean Windows VM:

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

## Release acceptance evidence

Before publishing a release, record all of the following against the exact commit being tagged:

- `Desktop shell CI` succeeded
- `Windows Package` succeeded
- exact Vitest file/test counts from the CI log
- `npm audit --audit-level=high` result
- Windows job produced exactly one installer
- Actions artifact contains `Family-Circle-Setup-0.1.0.exe`
- no forbidden secrets/model/user-data inputs are present in packaging configuration

After tagging `v0.1.0`, verify the tag-triggered Windows workflow succeeds and the GitHub Release contains exactly one downloadable `Family-Circle-Setup-0.1.0.exe` asset.
