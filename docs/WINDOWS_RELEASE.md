# Windows installer and automatic release procedure

Family Circle is packaged for Windows x64 as a one-click per-user NSIS installer. The normal installer contains the compiled Electron application and the offline-model manifests; it does not bundle Private AI model/runtime payloads, Vault data, `.env` files, mail credentials, Circle API credentials, or user data.

## Release source of truth

Releases are driven automatically from approved Conventional Commit titles merged to `main`.

Approved release types:

- `feat` -> minor
- `fix`, `perf`, `refactor`, `chore`, `ci`, `docs` -> patch
- any approved type using `!`, or a title containing `BREAKING CHANGE` / `BREAKING-CHANGE` -> major

Optional scopes are supported, for example `fix(auth): ...`.

A non-Conventional `main` commit may still build/test/package when its paths trigger CI, but it does not publish a server release, move `latest`, create a tag, or create a GitHub Release.

Pull-request titles are validated because squash-merge titles become the `main` commit subject and the human-facing release note.

## Semantic version calculation

The Windows workflow checks out full tag history and finds the highest stable tag matching `vMAJOR.MINOR.PATCH` that is already in the current commit history.

It then examines approved Conventional Commits since that tag and selects the highest release impact:

- any breaking change -> major
- otherwise any `feat` -> minor
- otherwise patch

Example from `v0.1.0`:

```text
fix: clean up shell chrome
feat: ship Family Tree
ci: automate semantic releases
```

produces `v0.2.0`, because the unreleased range contains a feature.

Once every eligible merge is automatically tagged, subsequent single-merge examples are the familiar:

```text
v0.2.0 + fix: ...   -> v0.2.1
v0.2.1 + feat: ...  -> v0.3.0
v0.3.0 + fix!: ...  -> v1.0.0
```

Because the automatic release system was introduced after several verified `0.1.0` demo builds already existed, the first semantic release has a one-time bootstrap boundary:

- baseline version: `0.1.0`
- baseline commit: `2e85ed47821928a2f6a2bd922f2836b56197ce22` (the last successful pre-Family-Tree release)

When no stable tag exists yet, the engine evaluates Conventional Commits after that commit. This intentionally includes the Family Tree `feat:` release, so the first automatic release is `v0.2.0`, not `v0.1.1`.

Once `v0.2.0` exists, the bootstrap commit is ignored and all future versions are derived exclusively from stable tags.

## Single-build release pipeline

For an eligible `main` commit, `.github/workflows/windows-package.yml` performs this sequence:

1. checkout with full tag history
2. derive the next semantic version and planned tag
3. install dependencies and run the full application verification against the checked-in source version
4. only after verification passes, apply the derived version inside the CI workspace with `npm version --no-git-tag-version`
5. generate the temporary demo/runtime compatibility configuration
6. build the Windows x64 NSIS installer once
7. verify the package and require exactly one installer
8. upload that exact installer as the Actions artifact
9. publish that same verified installer to the Family Circle server
10. download the public installer back and verify its SHA-256 and metadata
11. only after successful public verification, create the immutable Git tag on the original `main` commit
12. create the GitHub Release and attach that same installer plus its `.sha256`

There is no tag-triggered second build.

The source tree is not polluted with generated version-bump commits. The CI workspace version controls Electron/electron-builder packaging, so a release such as `v0.2.0` produces:

```text
Family-Circle-Setup-0.2.0.exe
Family-Circle-Setup-0.2.0.exe.sha256
```

The tag points to the actual feature/fix/CI merge commit that caused the release.

## Server metadata

New server releases use the clean semantic version as the immutable release directory and metadata version. They also carry the planned/created Git tag and a unique build identifier.

Example:

```json
{
  "version": "0.2.0",
  "tag": "v0.2.0",
  "build": "0.2.0-main-104e054",
  "channel": "main",
  "type": "feat",
  "title": "feat: ship Family Tree, notifications, and Circle switcher (#41)",
  "commit": "104e05417b6a1b7778a4becc11b3fc4e691647dc"
}
```

`current.json` describes the release behind `latest`. `versions.json` preserves release history for the download page. Older pre-semantic demo records remain readable.

## Interrupted-finalization recovery

A server publication can succeed even if the later GitHub tag/release finalization is interrupted. Before every new `main` package run, the workflow checks the live `current.json` for a semantic release that has a verified server installer but no matching Git tag.

If it finds one, it:

1. validates the semantic version/tag/commit/checksum metadata;
2. downloads the already-published installer from the Family Circle server;
3. verifies its SHA-256;
4. recreates the missing immutable tag on the verified commit;
5. creates or repairs the matching GitHub Release using those verified bytes.

Only after that recovery succeeds does the next `main` commit calculate its own semantic version. This prevents a failed finalizer from causing the next run to reuse the same semantic version or overwrite an immutable server release.

## Release ordering

Main release runs share the same workflow concurrency group and are not cancelled when a newer `main` push arrives. Pull-request runs may still cancel older PR runs.

This prevents two normal `main` release runs from racing to publish the same next version or moving `latest` out of order.

## Local Windows build

A normal local developer build still uses the checked-in package version:

```powershell
npm.cmd ci --no-audit
npm.cmd run check
npm.cmd run package:win
npm.cmd run verify:package
```

To reproduce a particular semantic release locally, first check out its tag and apply the release version to the workspace without creating another tag:

```powershell
npm.cmd version 0.2.0 --no-git-tag-version --allow-same-version
npm.cmd ci --no-audit
npm.cmd run package:win
npm.cmd run verify:package
```

## Signing and SmartScreen

The installer is currently unsigned, so Windows SmartScreen may show an unknown-publisher or reputation warning. Code signing can be added later without changing the semantic-release layout.

## Private AI stays progressive-download

Installing Family Circle does not bundle the Private AI model/runtime payloads. Upload/storage/extraction work without Private AI. The user explicitly chooses **Set up Private AI** later; the app downloads the configured runtime/model assets, verifies immutable size/SHA-256 metadata in the Electron main process, and stores them beneath Electron `userData`.

The installer must never include `.env`, `.env.*`, `*.gguf`, Private AI `models/` or `bin/` payloads, local databases, `.family-circle-data/`, Vault documents, or user data.

## Release acceptance evidence

An automatic release is complete only when all of these are true:

- Desktop/application CI passed
- Windows package verification passed
- exactly one semantic-versioned installer was produced
- the installer was published to the Family Circle server
- the public installer was downloaded back and its SHA-256 matched
- `current.json` matched the expected semantic version, tag, build, commit, type, title, and checksum
- the immutable `vX.Y.Z` tag points to the release-triggering `main` commit
- the GitHub Release contains the exact verified installer and its `.sha256` asset
