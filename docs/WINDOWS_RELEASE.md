# Windows installer and release procedure

Family Circle is packaged for Windows x64 as a one-click per-user NSIS installer. The normal installer contains the compiled Electron application and `config/offline-ai-manifest.json`; it does not bundle Private AI models/runtime assets, Vault data, `.env` files, SMTP credentials, Circle API credentials, or user data.

The Family Circle server is the continuous download channel for verified `main` builds. GitHub Releases remain available for tagged milestone releases. Branch and pull-request packaging runs also upload the installer as a GitHub Actions artifact for verification.

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

## Commit-driven server releases

Every relevant push to `main` builds and verifies the Windows installer, but **server publication happens only when the merged commit subject is an approved Conventional Commit**.

For example:

```text
feat: add family export
fix: add logout to authenticated profile menu
perf: speed up Vault indexing
```

become server release records carrying:

- `type`: the Conventional Commit prefix (`feat`, `fix`, `perf`, etc.; otherwise `change`)
- `title`: the exact first line of the merged `main` commit/PR title
- commit SHA
- published timestamp
- SHA-256
- immutable installer URL
- stable `latest` installer URL through `current.json`

`versions.json` preserves the existing `versions` string array for compatibility and also exposes a richer `releases` array for a download/history UI. Each release directory keeps its own immutable `release.json`; `current.json` describes the build currently behind `latest`.

The approved automatic-release types are `feat`, `fix`, `perf`, `refactor`, `chore`, `ci`, and `docs`, with optional scopes and optional `!` for a breaking change. Examples: `feat: add family export`, `fix(auth): correct invitation login`, and `feat!: replace the local data format`.

A non-Conventional `main` commit still goes through build/test/package verification when its changed paths trigger the workflow, but publication is intentionally skipped and the previous server `latest` remains untouched. The deployment status reports this as a successful `release-skipped` policy outcome rather than a deployment failure.

Pull-request titles are checked against the same rule because squash-merge titles become the `main` commit subject and therefore the human-facing release note.

A Git tag is therefore **not required for each downloadable server build**. Tags are reserved for milestone/formal GitHub releases, and the tagged commit must itself satisfy the same Conventional Commit rule.

## Release workflow

`.github/workflows/windows-package.yml` has two channels:

- every relevant push to `main` builds and verifies the installer; only approved Conventional Commit subjects publish the latest installer to the Family Circle server and enter release history;
- a stable version tag additionally publishes a **formal GitHub Release** for milestone/versioned distribution.

The Windows package gate performs:

1. checkout with full tag history
2. setup Node 24
3. validate any release tag before packaging
4. install dependencies with `npm ci --no-audit`
5. run the full `npm run check` quality gate
6. generate the temporary demo/runtime compatibility configuration
7. build the Windows x64 NSIS installer
8. run the deterministic package verifier
9. require exactly one `Family-Circle-Setup-*.exe`
10. upload that installer as a GitHub Actions artifact

A formal release tag is accepted only when all of these are true:

- the tag is stable SemVer exactly in the form `vMAJOR.MINOR.PATCH`, for example `v0.2.0`;
- the tag exactly matches the `package.json` version;
- the tagged commit is already contained in `main`;
- the version is newer than every existing stable release tag;
- the tagged commit subject is an approved Conventional Commit (`feat`, `fix`, `perf`, `refactor`, `chore`, `ci`, or `docs`).

If any rule fails, packaging stops and no GitHub Release is created.

For an accepted tag, GitHub Actions creates/reuses the matching GitHub Release, generates release notes, and uploads both:

- `Family-Circle-Setup-X.Y.Z.exe`
- `Family-Circle-Setup-X.Y.Z.exe.sha256`

### Normal release procedure

Prepare the version on a branch/PR first:

```powershell
npm version 0.2.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: prepare v0.2.0"
```

Merge that change to `main` and wait for the normal `main` CI/demo deployment to pass. Then tag that exact merged commit:

```powershell
git checkout main
git pull --ff-only
git tag v0.2.0
git push origin v0.2.0
```

The tag push is the explicit **formal GitHub Release** decision. Ordinary `main` pushes still create verified downloadable server releases; they simply do not create formal GitHub Releases.

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

After tagging a release, verify the tag-triggered Windows workflow succeeds and the GitHub Release contains the matching installer plus its `.sha256` checksum asset.
