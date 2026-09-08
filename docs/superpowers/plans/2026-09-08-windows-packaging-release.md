# Windows Packaging and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a verified, small Windows x64 NSIS installer for the rebuilt Family Circle app and publish version-tag builds as downloadable GitHub Release assets.

**Architecture:** Keep `dist/` as compiled application code and introduce `release/` as electron-builder output. Package only compiled app/runtime files plus the offline-AI manifest; Private AI models remain progressive-download assets. A dedicated Windows workflow runs the existing quality gate, builds the installer, verifies it, uploads it as an Actions artifact, and attaches it to a GitHub Release only for `v*` tags.

**Tech Stack:** Electron 44, Node 24, TypeScript 7, Vite 8, electron-builder, NSIS, GitHub Actions, GitHub Releases.

**Spec:** `docs/superpowers/specs/2026-09-08-windows-packaging-release-design.md`

## Global Constraints

- Normal installer is Windows x64 NSIS only.
- Artifact name is exactly `Family-Circle-Setup-${version}.exe`.
- electron-builder output directory is `release/`; compiled code remains in `dist/`.
- Do not package `.env`, `.env.*`, SMTP credentials, `CIRCLE_API_KEY`, Vault data, `*.gguf`, model binaries, `bin/`, or `models/`.
- `config/offline-ai-manifest.json` must be packaged.
- Private AI remains an explicit post-install download.
- First release version remains `0.1.0` unless the package version is deliberately changed.
- GitHub Releases are the canonical download source for this feature.
- No code-signing secrets or server SSH secrets are required for the first release.

---

### Task 1: Electron Builder Packaging Contract

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `build/family-circle.ico`
- Create: `.gitignore`
- Create: `src/main/packaging/packagingContract.test.ts`

**Interfaces:**
- Consumes: existing compiled paths `dist/main/main.js`, `dist/preload/preload.js`, and `dist/renderer/index.html`.
- Produces: `npm run package:win`, electron-builder `build` configuration, branded Windows installer configuration.

- [ ] **Step 1: Write the failing packaging contract test**

Create `src/main/packaging/packagingContract.test.ts`:

```ts
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageJson {
  scripts?: Record<string, string>
  build?: {
    appId?: string
    productName?: string
    files?: string[]
    directories?: { output?: string }
    win?: { target?: Array<{ target?: string; arch?: string[] }>; icon?: string }
    nsis?: { artifactName?: string; oneClick?: boolean; perMachine?: boolean; deleteAppDataOnUninstall?: boolean }
  }
}

const root = resolve(__dirname, '../../..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as PackageJson

describe('Windows packaging contract', () => {
  it('configures the small Family Circle x64 NSIS installer', () => {
    expect(pkg.scripts?.['package:win']).toContain('electron-builder')
    expect(pkg.build?.appId).toBe('com.kinkeepers.familycircle')
    expect(pkg.build?.productName).toBe('Family Circle')
    expect(pkg.build?.directories?.output).toBe('release')
    expect(pkg.build?.win?.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
    expect(pkg.build?.nsis?.artifactName).toBe('Family-Circle-Setup-${version}.exe')
    expect(pkg.build?.nsis?.oneClick).toBe(true)
    expect(pkg.build?.nsis?.perMachine).toBe(false)
    expect(pkg.build?.nsis?.deleteAppDataOnUninstall).toBe(false)
  })

  it('packages the compiled app and manifest but no secret/model inputs', () => {
    const files = pkg.build?.files ?? []
    expect(files).toContain('dist/**/*')
    expect(files).toContain('config/offline-ai-manifest.json')
    expect(files.join('\n')).not.toMatch(/\.env|\.gguf|models\/|bin\//i)
  })

  it('has a real Windows icon', () => {
    const icon = resolve(root, 'build/family-circle.ico')
    expect(existsSync(icon)).toBe(true)
    expect(statSync(icon).size).toBeGreaterThan(10_000)
  })
})
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
npm test -- src/main/packaging/packagingContract.test.ts
```

Expected: FAIL because `package:win`, electron-builder configuration, and `build/family-circle.ico` do not exist.

- [ ] **Step 3: Add electron-builder and the package configuration**

Update `package.json` scripts:

```json
"package:win": "npm run build && electron-builder --win nsis --x64",
"verify:package": "node scripts/verify-package.mjs"
```

Add `electron-builder` to `devDependencies` using npm so `package-lock.json` is updated consistently.

Add this top-level `build` object:

```json
{
  "appId": "com.kinkeepers.familycircle",
  "productName": "Family Circle",
  "asar": true,
  "files": [
    "dist/**/*",
    "config/offline-ai-manifest.json",
    "package.json",
    "!dist/**/*.map"
  ],
  "directories": {
    "output": "release"
  },
  "win": {
    "target": [
      {
        "target": "nsis",
        "arch": ["x64"]
      }
    ],
    "icon": "build/family-circle.ico"
  },
  "nsis": {
    "oneClick": true,
    "perMachine": false,
    "allowElevation": false,
    "allowToChangeInstallationDirectory": false,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "Family Circle",
    "artifactName": "Family-Circle-Setup-${version}.exe",
    "deleteAppDataOnUninstall": false
  },
  "compression": "normal"
}
```

- [ ] **Step 4: Add the reference Family Circle icon and ignore generated output**

Copy `assets/icons/family-circle.ico` from `Kasuletrevor/family-circle-app-rebuild` into `build/family-circle.ico` byte-for-byte.

Create `.gitignore`:

```text
node_modules/
dist/
release/
.env
.env.*
.family-circle-data/
models/
bin/
*.gguf
*.bin
```

- [ ] **Step 5: Run the packaging contract test GREEN**

Run:

```bash
npm test -- src/main/packaging/packagingContract.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit Task 1**

```bash
git add package.json package-lock.json build/family-circle.ico .gitignore src/main/packaging/packagingContract.test.ts
git commit -m "feat: configure Windows Electron packaging"
```

---

### Task 2: Package Verification and Security Gate

**Files:**
- Create: `scripts/verify-package.mjs`
- Create: `src/main/packaging/packageVerifierContract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: package.json electron-builder configuration, compiled `dist/`, optional packaged output in `release/`.
- Produces: `npm run verify:package`, a non-zero exit on packaging/security invariant violations.

- [ ] **Step 1: Write the failing verifier contract test**

Create `src/main/packaging/packageVerifierContract.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptPath = resolve(__dirname, '../../../scripts/verify-package.mjs')

describe('package verifier contract', () => {
  it('checks required compiled/runtime files and forbidden secret/model inputs', () => {
    const source = readFileSync(scriptPath, 'utf8')
    expect(source).toContain('dist/main/main.js')
    expect(source).toContain('dist/preload/preload.js')
    expect(source).toContain('dist/renderer/index.html')
    expect(source).toContain('config/offline-ai-manifest.json')
    expect(source).toContain('Family-Circle-Setup-')
    expect(source).toContain('.env')
    expect(source).toContain('.gguf')
    expect(source).toContain('models/')
    expect(source).toContain('bin/')
  })
})
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- src/main/packaging/packageVerifierContract.test.ts
```

Expected: FAIL because `scripts/verify-package.mjs` does not exist.

- [ ] **Step 3: Implement `scripts/verify-package.mjs`**

The script must:

1. parse `package.json`
2. assert the exact app identity, NSIS x64 target, output directory, artifact name, and icon path
3. assert required source build files exist when `dist/` exists
4. assert `build.files` contains only the compiled app/manifest/package inputs and has no `.env`, `.gguf`, `models/`, or `bin/` inputs
5. if `release/` exists, require exactly one installer matching `Family-Circle-Setup-${packageVersion}.exe`
6. reject any forbidden files found recursively under `release/win-unpacked/resources` outside electron-builder's own dependencies if their path contains `.env`, `.gguf`, `/models/`, or `/bin/`
7. print a concise success line and exit zero only when all applicable checks pass

Use only Node built-ins (`node:fs`, `node:path`, `node:url`) so verification adds no runtime dependency.

- [ ] **Step 4: Run verifier contract and normal tests GREEN**

Run:

```bash
npm test -- src/main/packaging/packageVerifierContract.test.ts src/main/packaging/packagingContract.test.ts
npm run build
npm run verify:package
```

Expected: both tests pass; build passes; verifier passes before installer creation while validating configuration and compiled files.

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/verify-package.mjs src/main/packaging/packageVerifierContract.test.ts package.json
git commit -m "test: verify Windows package boundaries"
```

---

### Task 3: Windows Packaging CI and Release Upload

**Files:**
- Create: `.github/workflows/windows-package.yml`
- Modify: `.github/workflows/desktop-shell-ci.yml`
- Create: `src/main/packaging/windowsWorkflowContract.test.ts`

**Interfaces:**
- Consumes: `npm run check`, `npm run package:win`, `npm run verify:package`.
- Produces: GitHub Actions artifact `family-circle-windows-<version>` and a GitHub Release `.exe` asset on `v*` tags.

- [ ] **Step 1: Write the workflow contract test RED**

Create `src/main/packaging/windowsWorkflowContract.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')

describe('Windows packaging workflow', () => {
  it('builds, verifies, uploads an artifact, and releases tag builds', () => {
    const workflow = readFileSync(resolve(root, '.github/workflows/windows-package.yml'), 'utf8')
    expect(workflow).toContain('windows-latest')
    expect(workflow).toContain('npm run check')
    expect(workflow).toContain('npm run package:win')
    expect(workflow).toContain('npm run verify:package')
    expect(workflow).toContain('actions/upload-artifact@')
    expect(workflow).toContain('Family-Circle-Setup-*.exe')
    expect(workflow).toContain("tags:\n      - 'v*'")
    expect(workflow).toContain('gh release upload')
  })
})
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- src/main/packaging/windowsWorkflowContract.test.ts
```

Expected: FAIL because `.github/workflows/windows-package.yml` does not exist.

- [ ] **Step 3: Implement `.github/workflows/windows-package.yml`**

The workflow must:

```yaml
name: Windows package

on:
  workflow_dispatch:
  push:
    branches:
      - feature/windows-packaging-release
    tags:
      - 'v*'
  pull_request:
    branches:
      - main

permissions:
  contents: write

jobs:
  package-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci --no-audit
      - run: npm run check
      - run: npm run package:win
      - run: npm run verify:package
      - name: Resolve installer
        id: installer
        shell: pwsh
        run: |
          $files = @(Get-ChildItem -Path release -Filter 'Family-Circle-Setup-*.exe' -File)
          if ($files.Count -ne 1) { throw "Expected exactly one Windows installer, found $($files.Count)." }
          "path=$($files[0].FullName)" >> $env:GITHUB_OUTPUT
          "name=$($files[0].Name)" >> $env:GITHUB_OUTPUT
      - uses: actions/upload-artifact@v4
        with:
          name: family-circle-windows-${{ github.sha }}
          path: ${{ steps.installer.outputs.path }}
          if-no-files-found: error
      - name: Publish GitHub Release
        if: startsWith(github.ref, 'refs/tags/v')
        shell: bash
        env:
          GH_TOKEN: ${{ github.token }}
          INSTALLER: ${{ steps.installer.outputs.path }}
          TAG: ${{ github.ref_name }}
        run: |
          set -euo pipefail
          gh release view "$TAG" >/dev/null 2>&1 || gh release create "$TAG" --title "Family Circle $TAG" --generate-notes
          gh release upload "$TAG" "$INSTALLER" --clobber
```

- [ ] **Step 4: Add this feature branch to the normal CI push list**

Add `feature/windows-packaging-release` under `.github/workflows/desktop-shell-ci.yml -> on.push.branches`.

- [ ] **Step 5: Run workflow contract GREEN and full local-contract gate**

Run:

```bash
npm test -- src/main/packaging/windowsWorkflowContract.test.ts
npm run check
npm audit --audit-level=high
```

Expected: workflow contract passes; complete project gate passes; audit reports no high/critical vulnerabilities.

- [ ] **Step 6: Commit Task 3**

```bash
git add .github/workflows/windows-package.yml .github/workflows/desktop-shell-ci.yml src/main/packaging/windowsWorkflowContract.test.ts
git commit -m "ci: build downloadable Windows installer"
```

---

### Task 4: Documentation, CI Artifact Proof, and First Release

**Files:**
- Create: `docs/WINDOWS_RELEASE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: successful `windows-package.yml` branch workflow.
- Produces: documented build/install/release procedure and, after merge, downloadable `v0.1.0` GitHub Release asset.

- [ ] **Step 1: Write `docs/WINDOWS_RELEASE.md`**

Document these exact commands:

```powershell
npm.cmd ci --no-audit
npm.cmd run check
npm.cmd run package:win
npm.cmd run verify:package
```

Document expected output:

```text
release/Family-Circle-Setup-0.1.0.exe
```

Document that the installer is currently unsigned and may trigger SmartScreen, that Private AI is downloaded later by explicit user action, and that `.env`/model assets are never part of the normal installer.

Include the 12-step clean-machine acceptance test from the design spec.

- [ ] **Step 2: Update README release section**

Add a concise `Windows installer` section pointing to `docs/WINDOWS_RELEASE.md`, describing GitHub Releases as the canonical download source and the progressive Private AI setup model.

- [ ] **Step 3: Commit documentation**

```bash
git add docs/WINDOWS_RELEASE.md README.md
git commit -m "docs: document Windows installer releases"
```

- [ ] **Step 4: Verify the exact branch head**

Wait for both GitHub workflows on the exact branch SHA and require:

- `Desktop shell CI`: success
- `Windows package`: success
- Windows package job shows exactly one installer
- Actions artifact exists and contains `Family-Circle-Setup-0.1.0.exe`

Also record the exact test count and `npm audit` result from logs.

- [ ] **Step 5: Review and merge through PR**

Compare `main...feature/windows-packaging-release`, review packaging/secrets/release boundaries, open a PR, and merge only after PR CI is green.

- [ ] **Step 6: Verify merged main**

Require the exact merged `main` SHA to pass `Desktop shell CI` and any packaging workflow triggered by the merge.

- [ ] **Step 7: Publish `v0.1.0`**

Create tag `v0.1.0` at the verified `main` SHA. Require the tag-triggered `Windows package` workflow to succeed and verify the GitHub Release contains exactly one `Family-Circle-Setup-0.1.0.exe` asset.

- [ ] **Step 8: Verify download availability**

Fetch the GitHub Release metadata and confirm the `.exe` asset has a browser download URL and non-zero size. Only then report the rebuilt Windows application as available for download.
