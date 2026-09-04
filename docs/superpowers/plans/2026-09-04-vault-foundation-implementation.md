# Vault Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fully usable private Vault with multi-file PDF/DOCX/TXT upload, extraction, listing, open/retry/delete, and truthful AI-readiness status without requiring Private AI.

**Architecture:** React talks only to `DesktopVaultClient` and the typed preload API. Electron main restores the protected local session and owns the file picker, AppData storage, hashing, duplicate/name handling, extraction and deletion recovery. This plan deliberately does not start or download models; successful extraction ends at `waiting_for_ai` for the linked RAG plan.

**Tech Stack:** Electron 44.1.1, TypeScript 7.0.2, Node 24, `node:sqlite`, `node:fs`, `node:crypto`, React 19.2.7, Vitest 4.1.11, `pdf-parse@2.4.5`, `mammoth@1.12.2`.

**Spec:** `docs/superpowers/specs/2026-09-04-vault-private-ai-design.md`

## Global Constraints

- Supported formats: **PDF, DOCX, TXT only**.
- Maximum file size: **50 MiB** per selected document.
- Vault ownership is authenticated local `AuthUser.id`, never active Circle/shared server identity.
- Upload/storage/extraction work in every Private AI state.
- Successful extraction ends at `indexStatus: 'waiting_for_ai'`.
- Renderer never receives source/stored paths, full extracted text, SHA-256, SQLite paths or arbitrary filesystem destinations.
- Electron main owns `dialog.showOpenDialog`; React never submits a path.
- Duplicate identity is `(local_user_id, sha256)`.
- Same bytes: return `already-exists`, no second copy. Same filename/different bytes: keep both and display `Name (2).ext`, `Name (3).ext`, etc.
- Multi-file failures are independent.
- No document bytes/text leave the machine or touch Jose's Circle adapter.
- Existing auth/Circle migrations and behavior remain unchanged.

---

### Task 1: Schema, internal models and repository

**Files:**
- Modify: `.github/workflows/desktop-shell-ci.yml`
- Modify: `src/main/database/migrations.ts`
- Modify: `src/main/database/migrations.test.ts`
- Create: `src/main/vault/vaultModels.ts`
- Create: `src/main/vault/VaultRepository.ts`
- Create: `src/main/vault/VaultRepository.test.ts`

**Interfaces:**
- Produces `VaultDocumentInternal`, extraction/index/delete status types, and repository methods `findByHash`, `insertStoredDocument`, `getByIdForUser`, `listByUser`, `listPendingDeletions`, extraction updates, delete-status updates and `deleteByIdForUser`.

- [ ] **Step 1: Enable branch CI**

Add `feature/vault-private-ai` under `on.push.branches` in `.github/workflows/desktop-shell-ci.yml` and commit it alone:

```bash
git add .github/workflows/desktop-shell-ci.yml
git commit -m "ci: verify Vault feature branch"
```

- [ ] **Step 2: Write migration RED tests**

Assert `vault_documents` contains:

```text
id, local_user_id, file_name, file_type, mime_type, size_bytes, sha256,
stored_relative_path, extraction_status, index_status, word_count, preview,
extracted_text, last_error_code, delete_status, uploaded_at, updated_at
```

Also assert `UNIQUE(local_user_id, sha256)` and FK `local_user_id -> users(id) ON DELETE CASCADE`, while a legacy user row survives migration unchanged.

```bash
npm test -- src/main/database/migrations.test.ts
```

Expected: FAIL because the table does not exist.

- [ ] **Step 3: Implement migration**

Inside the existing migration transaction create:

```sql
CREATE TABLE IF NOT EXISTS vault_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_user_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  stored_relative_path TEXT NOT NULL,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  index_status TEXT NOT NULL DEFAULT 'not_indexed',
  word_count INTEGER NOT NULL DEFAULT 0,
  preview TEXT,
  extracted_text TEXT,
  last_error_code TEXT,
  delete_status TEXT NOT NULL DEFAULT 'active',
  uploaded_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(local_user_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_vault_documents_user_uploaded
  ON vault_documents(local_user_id, uploaded_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_vault_documents_pending_delete
  ON vault_documents(local_user_id, delete_status);
```

- [ ] **Step 4: Write repository RED tests**

Cover:

```ts
it('scopes rows to the local user')
it('finds duplicate hashes only for that user')
it('allows another user to own the same hash')
it('stores extraction success and failure')
it('lists pending deletions')
it('cannot delete by id without the matching local user')
```

Expected RED:

```bash
npm test -- src/main/vault/VaultRepository.test.ts
```

- [ ] **Step 5: Implement repository and internal models**

`vaultModels.ts`:

```ts
export type VaultFileType = 'pdf' | 'docx' | 'txt'
export type VaultExtractionStatus = 'pending' | 'extracting' | 'ready' | 'failed'
export type VaultIndexStatus = 'not_indexed' | 'waiting_for_ai' | 'indexing' | 'indexed' | 'failed'
export type VaultDeleteStatus = 'active' | 'pending'
```

`VaultDocumentInternal` contains every DB field, including `localUserId`, `sha256`, `storedRelativePath` and `extractedText`; it is main-only.

Extraction success SQL must set:

```text
extraction_status='ready'
index_status='waiting_for_ai'
extracted_text=<text>
word_count=<count>
preview=<preview>
last_error_code=NULL
```

All SQL is parameterized.

- [ ] **Step 6: GREEN gate + commit**

```bash
npm test -- src/main/database/migrations.test.ts src/main/vault/VaultRepository.test.ts
npm run typecheck
git add src/main/database src/main/vault/vaultModels.ts src/main/vault/VaultRepository.ts src/main/vault/VaultRepository.test.ts
git commit -m "feat: add private Vault document persistence"
```

---

### Task 2: Private file store and text extraction

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/main/vault/VaultFileStore.ts`, `VaultFileStore.test.ts`
- Create: `src/main/vault/DocumentExtractor.ts`, `DocumentExtractor.test.ts`

**Interfaces:**
- Produces `MAX_VAULT_FILE_BYTES`, `validateSelectedDocument`, `sha256File`, `VaultFileStore.copyIntoVault/resolveOwnedPath/deleteOwnedFile`, `DocumentExtractor.extract`.

- [ ] **Step 1: Add only required parser dependencies**

```bash
npm install pdf-parse@2.4.5 mammoth@1.12.2
```

Do not add OCR/audio/vector/AI packages.

- [ ] **Step 2: Write file-store RED tests**

```ts
it('accepts valid txt under 50 MiB')
it('rejects unsupported extensions')
it('rejects >50 MiB before extraction')
it('checks %PDF- header for pdf')
it('checks PK zip signature for docx')
it('streams SHA-256 hashing')
it('stores under vault/users/<id>/documents with random storage name')
it('rejects relative-path traversal outside the user root')
it('treats ENOENT as successful cleanup')
```

- [ ] **Step 3: Implement validation/storage**

Supported mapping:

```ts
'.pdf'  -> { fileType: 'pdf',  mimeType: 'application/pdf' }
'.docx' -> { fileType: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
'.txt'  -> { fileType: 'txt',  mimeType: 'text/plain' }
```

Store at:

```ts
join(userDataPath, 'vault', 'users', String(localUserId), 'documents')
```

Persist only paths relative to `userDataPath`; generated storage names use `randomUUID()` plus the validated extension.

- [ ] **Step 4: Write extractor RED tests**

```ts
it('extracts UTF-8 txt')
it('computes word count and <=240-char preview')
it('uses mammoth.extractRawText for docx')
it('uses PDFParse.getText and always destroy() for pdf')
it('maps empty/parser failures to extraction-failed')
```

Inject PDF/DOCX parser functions in tests; no binary fixtures required.

- [ ] **Step 5: Implement extraction**

TXT uses `readFile(..., 'utf8')`; DOCX uses `mammoth.extractRawText({buffer})`; PDF uses:

```ts
const parser = new PDFParse({ data: await readFile(filePath) })
try {
  const result = await parser.getText()
  return result.text.trim()
} finally {
  await parser.destroy()
}
```

Store original extracted text; normalize whitespace only for preview.

- [ ] **Step 6: GREEN gate + commit**

```bash
npm test -- src/main/vault/VaultFileStore.test.ts src/main/vault/DocumentExtractor.test.ts
npm run typecheck
npm audit --audit-level=high
git add package.json package-lock.json src/main/vault/VaultFileStore* src/main/vault/DocumentExtractor*
git commit -m "feat: add local Vault file storage and extraction"
```

---

### Task 3: Session-scoped Vault service and deletion recovery

**Files:**
- Create: `src/main/vault/VaultService.ts`, `VaultService.test.ts`

**Interfaces:**

```ts
interface VaultSessionSource { restore(): Promise<AuthUser | null> }
interface VaultFilePicker { chooseDocuments(): Promise<string[]> }
interface VaultOpenPort { openPath(absolutePath: string): Promise<string> }
```

Produces `listDocuments`, `chooseAndUploadDocuments`, `openDocument`, `retryExtraction`, `deleteDocument`.

- [ ] **Step 1: Write auth/ownership RED tests**

```ts
it('requires a protected session for every operation')
it('never accepts renderer localUserId')
it('lists only the restored user documents')
it('cannot open/retry/delete another user document by guessed id')
```

- [ ] **Step 2: Write upload RED tests including approved name collision**

```ts
it('returns canceled when no files are selected')
it('processes multiple files independently')
it('rejects exact-byte duplicate before copy')
it('keeps same-name different bytes as separate documents')
it('renames display collision Family History.pdf -> Family History (2).pdf')
it('increments collision Family History (2).pdf -> Family History (3).pdf')
it('cleans copied file if DB insert fails')
it('keeps stored source when extraction fails')
it('marks extraction success waiting_for_ai without checking model readiness')
it('emits safe validating/saving/extracting/done progress')
```

Implement a pure helper:

```ts
uniqueDisplayName(originalName: string, existingNames: ReadonlySet<string>): string
```

Case-insensitive comparison on Windows-style names. Preserve extension; append ` (2)`, ` (3)` before it.

- [ ] **Step 3: Implement ingestion**

For each selected file:

```text
validate -> hash -> findByHash(user.id, hash)
-> if duplicate return already-exists
-> derive unique display name from repository.listByUser(user.id)
-> copy private source
-> insert extracting row
-> extract
-> success: ready + waiting_for_ai
-> extraction failure: keep file + failed row
```

Safe outcomes are `uploaded | already-exists | unsupported | too-large | extraction-failed | failed`.

- [ ] **Step 4: Write open/retry/delete RED tests**

```ts
it('opens only resolved owned path')
it('maps shell.openPath error string to open-failed')
it('retry re-extracts stored source')
it('marks delete pending before file removal')
it('keeps row retryable on file-delete failure')
it('repairs a pending delete when file is already gone')
```

- [ ] **Step 5: Implement deletion recovery**

```text
owned row -> mark pending -> delete file (ENOENT succeeds) -> delete DB row
```

On filesystem failure, reset to active and set stable `delete-failed`. If DB deletion fails after file deletion, row remains pending; `listDocuments()` starts by repairing pending rows and then returns authoritative active documents.

- [ ] **Step 6: GREEN gate + commit**

```bash
npm test -- src/main/vault/VaultService.test.ts
npm run typecheck
git add src/main/vault/VaultService*
git commit -m "feat: add protected Vault service"
```

---

### Task 4: Typed IPC/preload and safe progress subscriptions

**Files:**
- Modify: `src/shared/desktopApi.ts`
- Modify: `src/preload/createDesktopApi.ts`, `createDesktopApi.test.ts`, `preload.ts`
- Create: `src/main/vault/vaultIpc.ts`, `vaultIpc.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:**

Public `VaultDocumentSummary` contains only:

```ts
id, fileName, fileType, sizeBytes, extractionStatus, indexStatus,
wordCount, preview, issue, uploadedAt
```

Public Vault API:

```ts
listDocuments(): Promise<VaultDocumentSummary[]>
chooseAndUploadDocuments(): Promise<VaultUploadBatchResult>
openDocument({ documentId }): Promise<{ success: true }>
retryExtraction({ documentId }): Promise<VaultDocumentSummary>
deleteDocument({ documentId }): Promise<{ success: true }>
onUploadProgress(listener): () => void
```

- [ ] **Step 1: Write preload/public-contract RED tests**

Reject presence of `localUserId`, `sha256`, `storedRelativePath`, `sourcePath`, `absolutePath`, `extractedText` in public DTOs/results.

Extend `createDesktopApi` to accept:

```ts
type Subscribe = (channel: 'vault:upload-progress', listener: (payload: unknown) => void) => () => void
```

- [ ] **Step 2: Write IPC RED tests**

Channels:

```text
vault:list
vault:choose-and-upload
vault:open
vault:retry-extraction
vault:delete
```

IPC must reconstruct numeric `documentId`; extra renderer fields like `localUserId`, `path`, `sha256` are discarded. Progress event contains only file index/count/name/stage/percent.

- [ ] **Step 3: Implement preload subscription**

`preload.ts` wraps `ipcRenderer.on` and returns an unsubscribe removing the exact listener. No event object crosses context bridge.

- [ ] **Step 4: Wire main service**

Construct one `VaultRepository`, `VaultFileStore(userDataPath)`, `DocumentExtractor`, `VaultService`. Picker:

```ts
const result = await dialog.showOpenDialog({
  properties: ['openFile', 'multiSelections'],
  filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt'] }],
})
return result.canceled ? [] : result.filePaths
```

Open port uses `shell.openPath`.

- [ ] **Step 5: GREEN gate + commit**

```bash
npm test -- src/preload/createDesktopApi.test.ts src/main/vault/vaultIpc.test.ts
npm run typecheck
npm run build:electron
git add src/shared/desktopApi.ts src/preload src/main/vault/vaultIpc* src/main/main.ts
git commit -m "feat: expose safe Vault desktop API"
```

---

### Task 5: DesktopVaultClient and real `/vault` UI

**Files:**
- Create: `src/renderer/services/vault/VaultClient.ts`, `DesktopVaultClient.ts`, `DesktopVaultClient.test.ts`
- Create: `src/renderer/features/vault/Vault.tsx`, `Vault.css`, `Vault.test.tsx`
- Create: `src/renderer/features/vault/VaultDeleteDialog.tsx`, `VaultDeleteDialog.test.tsx`
- Modify: `src/renderer/app/App.tsx`, `App.test.tsx`

**Interfaces:** `VaultClient` mirrors the safe preload surface with numeric IDs only.

- [ ] **Step 1: Write DesktopVaultClient RED tests**

Prove it is the only renderer path to `window.familyCircle.vault`, shares one in-flight list request, and invalidates list state in `finally` after upload/retry/delete.

- [ ] **Step 2: Implement DesktopVaultClient**

Follow `DesktopCircleClient` request-sharing style; no production mock fallback.

- [ ] **Step 3: Write Vault UI RED tests**

```ts
it('shows private local empty state')
it('uploads and re-reads authoritative list')
it('renders file type/size/word count/status')
it('shows Ready for Private AI for waiting_for_ai')
it('shows safe per-file progress')
it('shows Retry extraction only for extraction failure')
it('opens through client')
it('confirms before delete')
it('keeps failed delete visible')
it('never disables Upload because AI is absent')
```

- [ ] **Step 4: Implement UI**

Approved header:

```text
Vault                                      Upload documents
Your private documents stay on this computer.
```

Status mapping:

```text
not_indexed -> Not indexed yet
waiting_for_ai -> Ready for Private AI
indexing -> Indexing...
indexed -> Ready to ask
failed -> AI indexing failed
```

Delete copy:

```text
Delete <file>?
This removes the local file and its Vault data from this computer.
Cancel | Delete document
```

Do not add AI setup controls in this plan.

- [ ] **Step 5: Route `/vault` only**

Import/render `<Vault />`; remove `/vault` from placeholders. Keep `/ai` placeholder for the RAG plan.

- [ ] **Step 6: GREEN gate + commit**

```bash
npm test -- src/renderer/services/vault src/renderer/features/vault src/renderer/app/App.test.tsx
npm run typecheck
npm run build:renderer
git add src/renderer/services/vault src/renderer/features/vault src/renderer/app/App*
git commit -m "feat: add private local Vault UI"
```

---

### Task 6: Security boundaries, recovery regression, docs and final gate

**Files:**
- Modify: `scripts/verify-boundaries.mjs`
- Create: `src/main/vault/VaultSecurity.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Strengthen mechanical boundaries**

In production Vault renderer/service code and the public Vault contract, reject:

```text
storedRelativePath, sourcePath, absolutePath, extractedText, sha256,
localUserId, embeddingBlob, modelPath, 127.0.0.1:8080, 127.0.0.1:8081
```

Allow `window.familyCircle.vault` only inside `DesktopVaultClient.ts`.

- [ ] **Step 2: Add merge-blocking security/recovery tests**

```ts
it('cannot open/retry/delete another user by guessed id')
it('never returns private path/hash/full text in summary/result/progress')
it('recovers pending deletion with missing source')
it('never calls the Circle adapter')
it('same-name upload does not replace old content')
```

- [ ] **Step 3: Update README**

State clearly: Vault is local-user private; PDF/DOCX/TXT upload/extraction works without AI; raw paths/full text stay in main; successful documents wait for the linked Private AI plan.

- [ ] **Step 4: Full verification**

```bash
npm ci
npm run typecheck
npm run test
npm run verify:boundaries
npm run build:electron
npm run build:renderer
npm audit --audit-level=high
```

- [ ] **Step 5: Merge-blocking review**

Review `main...feature/vault-private-ai` for no path/text leakage, no renderer identity/path input, no Circle/cloud dependency, no upload-AI coupling, no optimistic destructive success and correct same-name version behavior.

- [ ] **Step 6: Commit hardening**

```bash
git add scripts/verify-boundaries.mjs src/main/vault/VaultSecurity.test.ts README.md
git commit -m "test: harden private Vault boundaries"
```

Open the Vault-foundation PR only after CI is green on the exact final head. After that PR merges and its `main` SHA is green, create `feature/private-ai-rag` from that updated `main` and execute the linked RAG plan.
