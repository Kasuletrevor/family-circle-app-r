# Vault Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fully usable, private local Vault with multi-file PDF/DOCX/TXT upload, extraction, listing, open/retry/delete, and truthful AI-readiness status without requiring Private AI to be installed.

**Architecture:** Renderer Vault UI talks only to a typed `DesktopVaultClient`, which calls a narrow preload API. Electron main restores the protected local session and owns file selection, user-scoped AppData storage, SHA-256 duplicate detection, extraction, SQLite persistence, opening, deletion and recovery. This plan deliberately does not start or download any model; successful extraction ends at `waiting_for_ai` so the next plan can index without changing the document model.

**Tech Stack:** Electron 44.1.1, TypeScript 7.0.2, Node 24, `node:sqlite`, `node:fs`, `node:crypto`, React 19.2.7, Vitest 4.1.11, `pdf-parse@2.4.5`, `mammoth@1.12.2`.

**Spec:** `docs/superpowers/specs/2026-09-04-vault-private-ai-design.md`

## Global Constraints

- Initial supported document formats are **PDF, DOCX and TXT only**.
- Initial maximum selected file size is **50 MiB per document** (`50 * 1024 * 1024`).
- Vault ownership is the authenticated **local user ID**, never the active Circle or shared server user ID.
- Upload, storage and text extraction must work in every Private AI state; AI absence is not an upload failure.
- Successfully extracted documents in this plan end with `indexStatus: 'waiting_for_ai'`.
- The renderer never receives source paths, stored relative paths, extracted full text, SHA-256 values, SQLite paths or arbitrary filesystem destinations.
- File selection is owned by Electron main through `dialog.showOpenDialog`; React never supplies source paths.
- Duplicate identity is `(local_user_id, sha256)`. Same bytes are rejected as already present; same filename with different bytes is retained as a separate document.
- Multi-file upload is independent per file: one failure never rolls back another file.
- No document bytes/text are sent to Jose's Circle API, a cloud API, or a model service.
- No optimistic deletion or extraction success: renderer state is refreshed from authoritative main-process data after operations.
- Existing auth/Circle behavior and database-copy migration semantics must remain unchanged.
- CI must run on `feature/vault-private-ai` before the first RED/GREEN application checkpoint.

---

### Task 1: Vault schema, internal models and repository

**Files:**
- Modify: `.github/workflows/desktop-shell-ci.yml`
- Modify: `src/main/database/migrations.ts`
- Modify: `src/main/database/migrations.test.ts`
- Create: `src/main/vault/vaultModels.ts`
- Create: `src/main/vault/VaultRepository.ts`
- Create: `src/main/vault/VaultRepository.test.ts`

**Interfaces:**
- Consumes: existing `DatabaseSync`, users table and foreign-key/WAL setup.
- Produces:
  - `VaultDocumentInternal`
  - `VaultExtractionStatus = 'pending' | 'extracting' | 'ready' | 'failed'`
  - `VaultIndexStatus = 'not_indexed' | 'waiting_for_ai' | 'indexing' | 'indexed' | 'failed'`
  - `VaultRepository.findByHash(localUserId, sha256)`
  - `VaultRepository.insertStoredDocument(input)`
  - `VaultRepository.getByIdForUser(documentId, localUserId)`
  - `VaultRepository.listByUser(localUserId)`
  - `VaultRepository.listPendingDeletions(localUserId)`
  - `VaultRepository.markExtracting(...)`
  - `VaultRepository.markExtractionReady(...)`
  - `VaultRepository.markExtractionFailed(...)`
  - `VaultRepository.markDeletePending(...)`
  - `VaultRepository.markDeleteFailed(...)`
  - `VaultRepository.deleteByIdForUser(...)`

- [ ] **Step 1: Enable push CI for this feature branch**

Add the branch to `.github/workflows/desktop-shell-ci.yml`:

```yaml
on:
  push:
    branches:
      - main
      - feature/desktop-shell
      - feature/auth-onboarding
      - feature/real-circle-home
      - feature/circles-create-invite
      - feature/circle-members-invitations
      - feature/vault-private-ai
```

Commit this configuration-only change first so every later RED/GREEN commit generates evidence.

```bash
git add .github/workflows/desktop-shell-ci.yml
git commit -m "ci: verify Vault feature branch"
```

- [ ] **Step 2: Write failing migration tests**

Extend `src/main/database/migrations.test.ts` to prove a fresh DB and an upgraded legacy DB both contain `vault_documents` without changing existing user data.

Required schema assertions:

```ts
const columns = db.prepare('PRAGMA table_info(vault_documents)').all() as Array<{ name: string }>
expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
  'id',
  'local_user_id',
  'file_name',
  'file_type',
  'mime_type',
  'size_bytes',
  'sha256',
  'stored_relative_path',
  'extraction_status',
  'index_status',
  'word_count',
  'preview',
  'extracted_text',
  'last_error_code',
  'delete_status',
  'uploaded_at',
  'updated_at',
]))
```

Also assert the unique index on `(local_user_id, sha256)` and the foreign key to `users(id)` with `ON DELETE CASCADE`.

Run:

```bash
npm test -- src/main/database/migrations.test.ts
```

Expected: FAIL because `vault_documents` does not exist.

- [ ] **Step 3: Implement the migration**

Add an `ensureVaultDocuments(db)` helper in `src/main/database/migrations.ts` and invoke it inside the existing migration transaction.

Use this schema:

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

Do not rebuild or rename the existing users table.

- [ ] **Step 4: Write failing repository tests**

Create `src/main/vault/VaultRepository.test.ts` using an in-memory `DatabaseSync(':memory:')` and `runMigrations(db)`.

Cover:

```ts
it('scopes records to the local user')
it('finds exact-byte duplicates only inside the same user')
it('stores extraction success without exposing another user row')
it('stores extraction failure with a stable error code')
it('marks and lists pending deletions')
it('deletes only when document id and local user id match')
```

The duplicate test must prove two different local users may independently own the same SHA-256.

Run:

```bash
npm test -- src/main/vault/VaultRepository.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 5: Implement internal models and repository**

Create `src/main/vault/vaultModels.ts`:

```ts
export type VaultFileType = 'pdf' | 'docx' | 'txt'
export type VaultExtractionStatus = 'pending' | 'extracting' | 'ready' | 'failed'
export type VaultIndexStatus = 'not_indexed' | 'waiting_for_ai' | 'indexing' | 'indexed' | 'failed'
export type VaultDeleteStatus = 'active' | 'pending'

export interface VaultDocumentInternal {
  id: number
  localUserId: number
  fileName: string
  fileType: VaultFileType
  mimeType: string
  sizeBytes: number
  sha256: string
  storedRelativePath: string
  extractionStatus: VaultExtractionStatus
  indexStatus: VaultIndexStatus
  wordCount: number
  preview: string | null
  extractedText: string | null
  lastErrorCode: string | null
  deleteStatus: VaultDeleteStatus
  uploadedAt: number
  updatedAt: number
}
```

Implement `VaultRepository` with parameterized SQL only. Row mapping stays in this main-process file and never crosses preload.

Extraction-success update must be exact:

```sql
UPDATE vault_documents
   SET extraction_status = 'ready',
       index_status = 'waiting_for_ai',
       extracted_text = ?,
       word_count = ?,
       preview = ?,
       last_error_code = NULL,
       updated_at = ?
 WHERE id = ? AND local_user_id = ?
```

- [ ] **Step 6: Verify Task 1 green and commit**

Run:

```bash
npm test -- src/main/database/migrations.test.ts src/main/vault/VaultRepository.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add src/main/database/migrations.ts src/main/database/migrations.test.ts src/main/vault/vaultModels.ts src/main/vault/VaultRepository.ts src/main/vault/VaultRepository.test.ts
git commit -m "feat: add private Vault document persistence"
```

---

### Task 2: Private file store and PDF/DOCX/TXT extraction

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/main/vault/VaultFileStore.ts`
- Create: `src/main/vault/VaultFileStore.test.ts`
- Create: `src/main/vault/DocumentExtractor.ts`
- Create: `src/main/vault/DocumentExtractor.test.ts`

**Interfaces:**
- Consumes: `VaultFileType` from Task 1.
- Produces:
  - `MAX_VAULT_FILE_BYTES = 50 * 1024 * 1024`
  - `validateSelectedDocument(sourcePath): Promise<SelectedVaultFile>`
  - `sha256File(sourcePath): Promise<string>`
  - `VaultFileStore.copyIntoVault(input): Promise<{ storedRelativePath: string; absolutePath: string }>`
  - `VaultFileStore.resolveOwnedPath(localUserId, storedRelativePath): string`
  - `VaultFileStore.deleteOwnedFile(localUserId, storedRelativePath): Promise<void>`
  - `DocumentExtractor.extract(absolutePath, fileType): Promise<ExtractedDocument>`

- [ ] **Step 1: Install only the parser dependencies required by this slice**

```bash
npm install pdf-parse@2.4.5 mammoth@1.12.2
```

`pdf-parse@2.4.5` supports Node 24 and has TypeScript declarations; use its v2 `PDFParse` API. Do not add OCR, image, audio, vector-database or AI dependencies here.

- [ ] **Step 2: Write failing file-store tests**

Create temp-directory tests covering:

```ts
it('accepts a valid txt file under 50 MiB')
it('rejects unsupported extensions')
it('rejects a file larger than 50 MiB before extraction')
it('requires a PDF header for .pdf files')
it('requires a ZIP signature for .docx files')
it('hashes the file with SHA-256')
it('copies into vault/users/<id>/documents using a generated storage name')
it('refuses stored-relative-path traversal outside the user root')
it('treats ENOENT as successful cleanup during retryable deletion')
```

Run:

```bash
npm test -- src/main/vault/VaultFileStore.test.ts
```

Expected: FAIL because `VaultFileStore` does not exist.

- [ ] **Step 3: Implement file validation, hashing and private storage**

Use `node:fs/promises`, `createReadStream`, `createHash('sha256')`, `randomUUID()` and `node:path`.

Supported mapping:

```ts
const SUPPORTED = {
  '.pdf': { fileType: 'pdf', mimeType: 'application/pdf' },
  '.docx': { fileType: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.txt': { fileType: 'txt', mimeType: 'text/plain' },
} as const
```

Validation rules:

```ts
if (sizeBytes > MAX_VAULT_FILE_BYTES) throw new VaultFileError('too-large')
if (extension === '.pdf' && !header.startsWith('%PDF-')) throw new VaultFileError('unsupported')
if (extension === '.docx' && firstTwoBytes !== 'PK') throw new VaultFileError('unsupported')
```

Storage root is injected as the Electron `userDataPath`; a user document directory is:

```ts
join(userDataPath, 'vault', 'users', String(localUserId), 'documents')
```

Persist only a relative path such as:

```text
vault/users/42/documents/3b0b6...pdf
```

`resolveOwnedPath()` must normalize and reject any path that escapes `vault/users/<localUserId>/`.

- [ ] **Step 4: Write failing extraction tests**

Create `DocumentExtractor.test.ts` covering:

```ts
it('extracts UTF-8 TXT and returns word count and preview')
it('normalizes repeated whitespace for preview without altering stored text')
it('uses Mammoth raw-text extraction for DOCX')
it('uses PDFParse.getText for PDF and always destroys the parser')
it('rejects empty/unreadable extraction with a stable extraction-failed error')
```

Use dependency injection for PDF/DOCX parser functions so unit tests do not need binary fixtures.

Run:

```bash
npm test -- src/main/vault/DocumentExtractor.test.ts
```

Expected: FAIL because the extractor does not exist.

- [ ] **Step 5: Implement extraction**

Public result:

```ts
export interface ExtractedDocument {
  text: string
  wordCount: number
  preview: string
}
```

TXT:

```ts
const text = (await readFile(filePath, 'utf8')).trim()
```

DOCX default parser:

```ts
const result = await mammoth.extractRawText({ buffer: await readFile(filePath) })
const text = result.value.trim()
```

PDF default parser:

```ts
const parser = new PDFParse({ data: await readFile(filePath) })
try {
  const result = await parser.getText()
  return result.text.trim()
} finally {
  await parser.destroy()
}
```

Preview is at most 240 characters. Empty extracted text is a stable `extraction-failed`, not a raw parser error.

- [ ] **Step 6: Verify Task 2 green and commit**

```bash
npm test -- src/main/vault/VaultFileStore.test.ts src/main/vault/DocumentExtractor.test.ts
npm run typecheck
npm audit --audit-level=high
```

Expected: PASS and no high/critical dependency findings.

```bash
git add package.json package-lock.json src/main/vault/VaultFileStore.ts src/main/vault/VaultFileStore.test.ts src/main/vault/DocumentExtractor.ts src/main/vault/DocumentExtractor.test.ts
git commit -m "feat: add local Vault file storage and extraction"
```

---

### Task 3: Session-scoped Vault service and recovery semantics

**Files:**
- Create: `src/main/vault/VaultService.ts`
- Create: `src/main/vault/VaultService.test.ts`

**Interfaces:**
- Consumes: `VaultRepository`, `VaultFileStore`, `DocumentExtractor`, protected `SessionStore.restore()` semantics.
- Produces:
  - `VaultSessionSource`
  - `VaultFilePicker`
  - `VaultOpenPort`
  - `VaultService.listDocuments()`
  - `VaultService.chooseAndUploadDocuments(onProgress?)`
  - `VaultService.openDocument(documentId)`
  - `VaultService.retryExtraction(documentId)`
  - `VaultService.deleteDocument(documentId)`
  - safe document/result/progress types later exported from shared contract in Task 4.

- [ ] **Step 1: Write failing service tests for authentication and ownership**

Cover:

```ts
it('requires a protected local session for every Vault operation')
it('lists only documents owned by the restored local user')
it('cannot open another local user document by guessing its id')
it('cannot retry extraction for another local user')
it('cannot delete another local user document')
```

The renderer never supplies `localUserId`; every method derives it from `sessions.restore()`.

- [ ] **Step 2: Write failing upload-flow tests**

Use fake picker/file-store/extractor/repository ports and cover:

```ts
it('returns canceled when the picker selects no files')
it('uploads multiple selected files independently')
it('rejects exact-byte duplicate before copying')
it('keeps same-name different-content documents')
it('cleans a copied file if inserting its DB row fails')
it('keeps the stored source when extraction fails')
it('marks successful extraction waiting_for_ai without checking model readiness')
it('emits validating, saving, extracting and done progress without paths')
```

Safe per-file outcome union:

```ts
type VaultUploadOutcome =
  | 'uploaded'
  | 'already-exists'
  | 'unsupported'
  | 'too-large'
  | 'extraction-failed'
  | 'failed'
```

- [ ] **Step 3: Implement session-scoped ingestion**

Define:

```ts
export interface VaultSessionSource {
  restore(): Promise<AuthUser | null>
}

export interface VaultFilePicker {
  chooseDocuments(): Promise<string[]>
}

export interface VaultOpenPort {
  openPath(absolutePath: string): Promise<string>
}
```

`chooseAndUploadDocuments()` must:

```text
restore session once for the operation
-> picker returns paths
-> for each path:
   validate
   hash
   repository.findByHash(user.id, hash)
   if duplicate: safe already-exists result
   copy to private store
   insert row with extraction_status='extracting', index_status='not_indexed'
   extract
   on success mark ready + waiting_for_ai
   on extraction failure keep source + mark extraction failed
-> return every file outcome
```

Do not make any model/runtime/status call in this plan.

- [ ] **Step 4: Write failing open/retry/delete recovery tests**

Cover:

```ts
it('opens a document only after resolving its owned path in main')
it('maps shell.openPath non-empty response to a safe open-failed error')
it('retry extraction reuses the stored source and resets a failed row on success')
it('delete marks pending before filesystem removal')
it('delete keeps metadata recoverable when filesystem removal fails')
it('listDocuments repairs a previous pending deletion after the source file is already gone')
```

- [ ] **Step 5: Implement open/retry/delete and pending-delete repair**

Deletion order:

```text
load owned row
-> mark delete_status='pending'
-> delete source file (ENOENT counts as already deleted)
-> delete DB row for (id, local_user_id)
```

If filesystem deletion fails, call `markDeleteFailed()` so the row remains visible/retryable with stable `last_error_code='delete-failed'`.

If DB deletion fails after the file was removed, the row remains pending. At the start of `listDocuments()`, `recoverPendingDeletions(userId)` retries the file cleanup (ENOENT succeeds) and removes the row. This is the required crash/partial-delete recovery path.

- [ ] **Step 6: Verify Task 3 green and commit**

```bash
npm test -- src/main/vault/VaultService.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add src/main/vault/VaultService.ts src/main/vault/VaultService.test.ts
git commit -m "feat: add protected Vault service"
```

---

### Task 4: Typed Vault IPC, preload API and safe progress subscription

**Files:**
- Modify: `src/shared/desktopApi.ts`
- Modify: `src/preload/createDesktopApi.ts`
- Modify: `src/preload/createDesktopApi.test.ts`
- Modify: `src/preload/preload.ts`
- Create: `src/main/vault/vaultIpc.ts`
- Create: `src/main/vault/vaultIpc.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:**
- Consumes: `VaultService` methods from Task 3.
- Produces public safe DTOs and `window.familyCircle.vault` methods.

- [ ] **Step 1: Write failing public-contract/preload tests**

Add these safe public types to the test expectations:

```ts
export type VaultExtractionStatus = 'pending' | 'extracting' | 'ready' | 'failed'
export type VaultIndexStatus = 'not_indexed' | 'waiting_for_ai' | 'indexing' | 'indexed' | 'failed'

export interface VaultDocumentSummary {
  id: number
  fileName: string
  fileType: 'pdf' | 'docx' | 'txt'
  sizeBytes: number
  extractionStatus: VaultExtractionStatus
  indexStatus: VaultIndexStatus
  wordCount: number
  preview: string | null
  issue: 'extraction-failed' | 'delete-failed' | null
  uploadedAt: number
}
```

Public API:

```ts
vault: {
  listDocuments(): Promise<VaultDocumentSummary[]>
  chooseAndUploadDocuments(): Promise<VaultUploadBatchResult>
  openDocument(input: { documentId: number }): Promise<{ success: true }>
  retryExtraction(input: { documentId: number }): Promise<VaultDocumentSummary>
  deleteDocument(input: { documentId: number }): Promise<{ success: true }>
  onUploadProgress(listener: (progress: VaultUploadProgress) => void): () => void
}
```

Assert the public types do **not** include `localUserId`, `sha256`, `storedRelativePath`, `sourcePath`, `absolutePath` or `extractedText`.

- [ ] **Step 2: Extend `createDesktopApi` for invoke + subscriptions**

Change the factory signature to:

```ts
type Subscribe = (channel: DesktopEventChannel, listener: (payload: unknown) => void) => () => void

export function createDesktopApi(invoke: Invoke, subscribe: Subscribe = () => () => {}): DesktopApi
```

Add channels:

```ts
| 'vault:list'
| 'vault:choose-and-upload'
| 'vault:open'
| 'vault:retry-extraction'
| 'vault:delete'
```

and event channel:

```ts
type DesktopEventChannel = 'vault:upload-progress'
```

The preload implementation uses `ipcRenderer.on` and removes the exact listener on unsubscribe.

- [ ] **Step 3: Write failing IPC tests**

Create `vaultIpc.test.ts` with a fake IPC registrar and fake service. Prove:

```ts
it('registers the five Vault request channels')
it('passes only numeric documentId business input')
it('does not accept renderer-supplied localUserId or path fields')
it('sends only sanitized VaultUploadProgress events')
```

For input sanitization, handlers reconstruct payloads:

```ts
const documentId = Number((payload as { documentId?: unknown })?.documentId)
return service.openDocument(documentId)
```

No arbitrary payload object is forwarded to the service.

- [ ] **Step 4: Implement IPC and wire production dependencies in main**

In `main.ts`, import `dialog` and `shell` and construct:

```ts
const vaultRepository = new VaultRepository(database)
const vaultFiles = new VaultFileStore(userDataPath)
const extractor = new DocumentExtractor()
const vaultService = new VaultService(
  sessions,
  vaultRepository,
  vaultFiles,
  extractor,
  {
    async chooseDocuments() {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt'] }],
      })
      return result.canceled ? [] : result.filePaths
    },
  },
  { openPath: (filePath) => shell.openPath(filePath) },
)
```

Return `vaultService` from `createAppServices()` and pass it to `registerDesktopIpc(...)`.

- [ ] **Step 5: Verify Task 4 green and commit**

```bash
npm test -- src/preload/createDesktopApi.test.ts src/main/vault/vaultIpc.test.ts
npm run typecheck
npm run build:electron
```

Expected: PASS.

```bash
git add src/shared/desktopApi.ts src/preload/createDesktopApi.ts src/preload/createDesktopApi.test.ts src/preload/preload.ts src/main/vault/vaultIpc.ts src/main/vault/vaultIpc.test.ts src/main/main.ts
git commit -m "feat: expose safe Vault desktop API"
```

---

### Task 5: DesktopVaultClient and real Vault UI

**Files:**
- Create: `src/renderer/services/vault/VaultClient.ts`
- Create: `src/renderer/services/vault/DesktopVaultClient.ts`
- Create: `src/renderer/services/vault/DesktopVaultClient.test.ts`
- Create: `src/renderer/features/vault/Vault.tsx`
- Create: `src/renderer/features/vault/Vault.css`
- Create: `src/renderer/features/vault/Vault.test.tsx`
- Create: `src/renderer/features/vault/VaultDeleteDialog.tsx`
- Create: `src/renderer/features/vault/VaultDeleteDialog.test.tsx`
- Modify: `src/renderer/app/App.tsx`
- Modify: `src/renderer/app/App.test.tsx`

**Interfaces:**
- Consumes: `window.familyCircle.vault` from Task 4.
- Produces: real `/vault` document-management route.

- [ ] **Step 1: Write failing DesktopVaultClient tests**

Define:

```ts
export interface VaultClient {
  listDocuments(): Promise<VaultDocumentSummary[]>
  chooseAndUploadDocuments(): Promise<VaultUploadBatchResult>
  openDocument(documentId: number): Promise<void>
  retryExtraction(documentId: number): Promise<VaultDocumentSummary>
  deleteDocument(documentId: number): Promise<void>
  onUploadProgress(listener: (progress: VaultUploadProgress) => void): () => void
}
```

Tests must prove it calls only `window.familyCircle.vault`, forwards document IDs only, and clears its in-flight `listDocuments()` cache after upload/retry/delete success **or failure**.

Run:

```bash
npm test -- src/renderer/services/vault/DesktopVaultClient.test.ts
```

Expected: FAIL because the client does not exist.

- [ ] **Step 2: Implement DesktopVaultClient**

Use the same request-sharing pattern as `DesktopCircleClient`: one in-flight list promise, cleared when resolved/rejected. Mutations clear the list cache in `finally`.

- [ ] **Step 3: Write failing Vault UI tests**

Cover:

```ts
it('shows a private local Vault empty state')
it('uploads through the client and refreshes authoritative documents')
it('renders PDF/DOCX/TXT metadata and truthful extraction/index states')
it('shows Ready for Private AI for waiting_for_ai documents')
it('shows per-file upload progress without filesystem paths')
it('shows Retry extraction only for extraction failures')
it('opens a document through the client')
it('requires confirmation before delete')
it('keeps a failed delete visible with stable safe copy')
it('does not disable Upload documents because AI is unavailable')
```

Approved empty-state copy:

```text
Your private Vault
Keep family documents on this computer. You can add PDF, DOCX and TXT files now; Private AI can be set up later for searching and questions.
```

- [ ] **Step 4: Implement the Vault page and delete dialog**

Header:

```text
Vault                                      Upload documents
Your private documents stay on this computer.
```

Status mapping:

```ts
const indexCopy = {
  not_indexed: 'Not indexed yet',
  waiting_for_ai: 'Ready for Private AI',
  indexing: 'Indexing...',
  indexed: 'Ready to ask',
  failed: 'AI indexing failed',
}
```

Extraction failure copy:

```text
Stored, but text could not be extracted
```

Delete confirmation:

```text
Delete <file name>?
This removes the local file and its Vault data from this computer.
Cancel | Delete document
```

Do not add AI setup buttons yet; Plan 2 owns setup/indexing UX.

- [ ] **Step 5: Replace only the `/vault` placeholder route**

In `App.tsx`, import `Vault`, add:

```tsx
<Route path="/vault" element={<Vault />} />
```

and remove `/vault` from `placeholderRoutes`. Keep `/ai` as a placeholder until Plan 2.

- [ ] **Step 6: Verify Task 5 green and commit**

```bash
npm test -- src/renderer/services/vault/DesktopVaultClient.test.ts src/renderer/features/vault/Vault.test.tsx src/renderer/features/vault/VaultDeleteDialog.test.tsx src/renderer/app/App.test.tsx
npm run typecheck
npm run build:renderer
```

Expected: PASS.

```bash
git add src/renderer/services/vault src/renderer/features/vault src/renderer/app/App.tsx src/renderer/app/App.test.tsx
git commit -m "feat: add private local Vault UI"
```

---

### Task 6: Vault security boundaries, recovery coverage, docs and final gate

**Files:**
- Modify: `scripts/verify-boundaries.mjs`
- Create: `src/main/vault/VaultSecurity.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: complete Vault foundation.
- Produces: mechanical privacy enforcement and merge-ready verification evidence.

- [ ] **Step 1: Write failing boundary/security assertions**

Extend `verify-boundaries.mjs` with Vault-specific rules.

For production files under `src/renderer/features/vault/` and `src/renderer/services/vault/`, reject:

```text
storedRelativePath
sourcePath
absolutePath
extractedText
sha256
localUserId
127.0.0.1:8080
127.0.0.1:8081
```

For the public desktop contract's Vault section, reject:

```text
storedRelativePath
sourcePath
absolutePath
extractedText
sha256
embeddingBlob
modelPath
```

Also enforce that production renderer code may access `window.familyCircle.vault` only from `DesktopVaultClient.ts`.

- [ ] **Step 2: Add main-process cross-user and crash-recovery regression tests**

Create `VaultSecurity.test.ts` proving:

```ts
it('never opens another user document by guessed id')
it('never retries another user document by guessed id')
it('never deletes another user document by guessed id')
it('never returns private paths or extracted text in summaries/results/progress')
it('recovers a pending delete with an already-missing source file')
it('does not call any Circle adapter during Vault operations')
```

- [ ] **Step 3: Update README to describe the shipped boundary**

Document:

```text
Vault documents are local-user private data.
PDF/DOCX/TXT upload and extraction work without Private AI.
No raw paths or extracted document text cross into React.
Successful extracted files remain Ready for Private AI until the next feature slice indexes them.
```

Keep Private AI/model setup explicitly described as the next linked plan, not as already implemented.

- [ ] **Step 4: Run focused final checks**

```bash
npm test -- src/main/vault src/renderer/services/vault src/renderer/features/vault
npm run verify:boundaries
```

Expected: PASS.

- [ ] **Step 5: Run the exact full repository gate**

```bash
npm ci
npm run typecheck
npm run test
npm run verify:boundaries
npm run build:electron
npm run build:renderer
npm audit --audit-level=high
```

Expected: all application checks/builds pass; audit has no high/critical findings. If the npm advisory service itself times out, use the repository CI retry behavior and distinguish infrastructure failure from a real vulnerability finding.

- [ ] **Step 6: Review and commit hardening**

Review `main...feature/vault-private-ai` for:

```text
no renderer filesystem paths
no extracted full text in public DTOs
no localUserId supplied by renderer
no Circle/shared API dependency
no upload dependency on AI readiness
no optimistic destructive success
no same-name replacement behavior
```

Then commit:

```bash
git add scripts/verify-boundaries.mjs src/main/vault/VaultSecurity.test.ts README.md
git commit -m "test: harden private Vault boundaries"
```

The branch is ready for a Vault-foundation PR only when CI passes on the exact final head.
