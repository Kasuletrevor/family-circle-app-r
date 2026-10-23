import type {
  AddTreeRelationInput,
  AuthState,
  ChangePasswordInput,
  CircleContext,
  CircleDetails,
  CircleListItem,
  CirclePhotoChoice,
  CircleOverview,
  CreateCircleInput,
  CreateCircleResult,
  DesktopApi,
  InvitationCheckResult,
  InviteMemberInput,
  InviteMemberResult,
  LocalBackupResult,
  LocalRestoreResult,
  OnboardingNextAction,
  PrivateAiPublicProgress,
  PrivateAiPublicState,
  PrivateAiPublicStatus,
  RegisterInput,
  SaveTreePositionInput,
  ResendInvitationResult,
  ResetPasswordInput,
  SignInInput,
  SpeechPublicResult,
  SpokenVoicePublic,
  StoryMediaAddResult,
  StoryMediaPublicItem,
  VaultAnswer,
  VaultDocumentIssue,
  VaultDocumentSummary,
  VaultExtractionStatus,
  VaultFileType,
  VaultIndexStatus,
  VaultQueryScope,
  VaultUploadBatchResult,
  VaultUploadOutcome,
  VaultUploadProgress,
  VaultUploadStage,
  VoicePublicProgress,
  VoicePublicStatus,
} from '../shared/desktopApi'
import {
  isGuardianAngelTemplate,
  isMyGuardianAngel,
  isPartnerServiceKey,
  publicAngel,
  publicTemplate,
  safeAngelConnection,
  type AddAngelResult,
  type GuardianAngelCatalogResult,
  type MyAngelsResult,
  type PartnerViewStatus,
  type PartnerViewTarget,
  type RemoveAngelResult,
} from '../shared/agentic'
import { safeAngelChatOpen, safeAngelChatSend } from '../shared/agenticChat'
import { normalizeStoryLanguage, requireStoryField, type StoryIndexStatus, type StoryLanguage } from '../shared/story'
import type { StoryPublicAnswer, StoryPublicState, StoryVersionSummary } from '../shared/storyPublic'

type DesktopChannel =
  | 'app:get-version'
  | 'app:get-platform'
  | 'auth:restore'
  | 'auth:sign-in'
  | 'auth:check-invitation'
  | 'auth:register'
  | 'auth:sign-out'
  | 'auth:request-password-reset'
  | 'auth:reset-password'
  | 'auth:update-profile'
  | 'auth:change-password'
  | 'onboarding:get-state'
  | 'onboarding:set-initial-password'
  | 'onboarding:update-profile'
  | 'onboarding:get-circle-context'
  | 'onboarding:complete'
  | 'circle:get-overview'
  | 'circle:get-my-circles'
  | 'circle:get-details'
  | 'circle:select'
  | 'circle:create'
  | 'circle:invite-member'
  | 'circle:add-tree-relation'
  | 'circle:delete-tree-relation'
  | 'circle:save-tree-position'
  | 'circle:mark-notifications-read'
  | 'circle:resend-invitation'
  | 'circle:cancel-invitation'
  | 'circle:remove-member'
  | 'circle:leave'
  | 'circle:rename'
  | 'circle:delete'
  | 'circle:photos-list'
  | 'circle:photo-choose'
  | 'circle:photo-remove'
  | 'vault:list'
  | 'vault:choose-and-upload'
  | 'vault:open'
  | 'vault:retry-extraction'
  | 'vault:retry-indexing'
  | 'vault:delete'
  | 'vault:ask'
  | 'settings:create-backup'
  | 'settings:open-data-folder'
  | 'settings:restore-backup'
  | 'private-ai:get-status'
  | 'private-ai:start-setup'
  | 'private-ai:pause-setup'
  | 'private-ai:repair'
  | 'private-ai:remove'
  | 'story:get'
  | 'story:save-draft'
  | 'story:confirm-field'
  | 'story:retry-indexing'
  | 'story:save-now'
  | 'story:get-history'
  | 'story:restore-version'
  | 'story:choose-add-media'
  | 'story:list-media'
  | 'story:open-media'
  | 'story:delete-media'
  | 'story:transcribe-recording'
  | 'story:voice-status'
  | 'story:voice-start-setup'
  | 'story:voice-pause-setup'
  | 'story:voice-repair-setup'
  | 'speech:list-voices'
  | 'speech:synthesize'
  | 'agentic:catalog'
  | 'agentic:open-view'
  | 'agentic:set-view-bounds'
  | 'agentic:hide-view'
  | 'agentic:view-command'
  | 'agentic:angel-connection'
  | 'agentic:connect'
  | 'agentic:cancel-connect'
  | 'agentic:disconnect'
  | 'agentic:my-angels'
  | 'agentic:add-angel'
  | 'agentic:remove-angel'
  | 'agentic:angel-chat-open'
  | 'agentic:angel-chat-send'
  | 'agentic:angel-chat-clear'

type Invoke = (channel: DesktopChannel, payload?: unknown) => Promise<unknown>
type DesktopEventChannel = 'vault:upload-progress' | 'private-ai:progress' | 'story:voice-setup-progress' | 'agentic:view-state'
  | 'agentic:angel-connection-changed'
type Subscribe = (channel: DesktopEventChannel, listener: (payload: unknown) => void) => () => void

function recordOf(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function safeFileType(value: unknown): VaultFileType {
  return value === 'pdf' || value === 'docx' || value === 'txt' ? value : 'txt'
}

function safeExtractionStatus(value: unknown): VaultExtractionStatus {
  return value === 'pending' || value === 'extracting' || value === 'ready' || value === 'failed'
    ? value
    : 'failed'
}

function safeIndexStatus(value: unknown): VaultIndexStatus {
  return value === 'not_indexed'
    || value === 'waiting_for_ai'
    || value === 'indexing'
    || value === 'indexed'
    || value === 'failed'
    ? value
    : 'not_indexed'
}

function safeIssue(value: unknown): VaultDocumentIssue {
  return value === 'extraction-failed' || value === 'delete-failed' ? value : null
}

function safeUploadOutcome(value: unknown): VaultUploadOutcome {
  return value === 'uploaded'
    || value === 'already-exists'
    || value === 'unsupported'
    || value === 'too-large'
    || value === 'extraction-failed'
    || value === 'failed'
    ? value
    : 'failed'
}

function safeUploadStage(value: unknown): VaultUploadStage {
  return value === 'validating' || value === 'saving' || value === 'extracting' || value === 'done'
    ? value
    : 'done'
}

function safePrivateAiState(value: unknown): PrivateAiPublicState {
  return value === 'not_installed'
    || value === 'downloading'
    || value === 'paused'
    || value === 'verifying'
    || value === 'ready'
    || value === 'repair_required'
    || value === 'failed'
    ? value
    : 'failed'
}

function safeSummary(value: unknown): VaultDocumentSummary {
  const raw = recordOf(value)
  return {
    id: Number(raw.id),
    fileName: String(raw.fileName ?? ''),
    fileType: safeFileType(raw.fileType),
    sizeBytes: Number(raw.sizeBytes) || 0,
    extractionStatus: safeExtractionStatus(raw.extractionStatus),
    indexStatus: safeIndexStatus(raw.indexStatus),
    wordCount: Number(raw.wordCount) || 0,
    preview: raw.preview == null ? null : String(raw.preview),
    issue: safeIssue(raw.issue),
    uploadedAt: Number(raw.uploadedAt) || 0,
    indexProgress: safeIndexProgress(raw.indexProgress),
  }
}

function safeIndexProgress(value: unknown): VaultDocumentSummary['indexProgress'] {
  if (value == null) return null
  const raw = recordOf(value)
  const done = Number(raw.done)
  const total = Number(raw.total)
  return Number.isSafeInteger(done) && Number.isSafeInteger(total) && total > 0 && done >= 0
    ? { done: Math.min(done, total), total }
    : null
}

function safeUploadBatch(value: unknown): VaultUploadBatchResult {
  const raw = recordOf(value)
  const rawItems = Array.isArray(raw.items) ? raw.items : []
  return {
    canceled: raw.canceled === true,
    items: rawItems.map((item) => {
      const row = recordOf(item)
      const documentId = Number(row.documentId)
      return {
        fileName: String(row.fileName ?? ''),
        outcome: safeUploadOutcome(row.outcome),
        ...(Number.isSafeInteger(documentId) && documentId > 0 ? { documentId } : {}),
      }
    }),
  }
}

function safeProgress(value: unknown): VaultUploadProgress {
  const raw = recordOf(value)
  return {
    fileIndex: Number(raw.fileIndex) || 0,
    fileCount: Number(raw.fileCount) || 0,
    fileName: String(raw.fileName ?? ''),
    stage: safeUploadStage(raw.stage),
    percent: Number(raw.percent) || 0,
  }
}

function safeAnswer(value: unknown): VaultAnswer {
  const raw = recordOf(value)
  const sources = Array.isArray(raw.sources) ? raw.sources : []
  return {
    answer: String(raw.answer ?? ''),
    sources: sources.flatMap((source): VaultAnswer['sources'] => {
      const row = recordOf(source)
      const excerpt = String(row.excerpt ?? '').slice(0, 320)
      if (row.sourceType === 'story') {
        return [{ sourceType: 'story', chapter: String(row.chapter ?? ''), label: String(row.label ?? ''), excerpt }]
      }
      const documentId = Number(row.documentId)
      return Number.isSafeInteger(documentId) && documentId > 0
        ? [{ sourceType: 'document', documentId, fileName: String(row.fileName ?? ''), excerpt }]
        : []
    }),
  }
}

function safeQueryScope(scope: VaultQueryScope): VaultQueryScope {
  if (scope.type === 'all' || scope.type === 'story' || scope.type === 'story-and-vault') return { type: scope.type }
  return {
    type: 'documents',
    documentIds: scope.documentIds.filter((id) => Number.isSafeInteger(id) && id > 0),
  }
}

function safeBackupResult(value: unknown): LocalBackupResult {
  const raw = recordOf(value)
  const createdAt = Number(raw.createdAt)
  return {
    canceled: raw.canceled === true,
    folderName: raw.folderName == null ? null : String(raw.folderName),
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : null,
  }
}

function safePrivateAiStatus(value: unknown): PrivateAiPublicStatus {
  const raw = recordOf(value)
  const state = safePrivateAiState(raw.state)
  const totalSizeBytes = Number(raw.totalSizeBytes) || 0
  return {
    state,
    ready: raw.ready === true && state === 'ready',
    repairRequired: raw.repairRequired === true && state === 'repair_required',
    totalSizeBytes,
    // Older hosts do not report a separate download size; assume the full download.
    downloadSizeBytes: raw.downloadSizeBytes == null
      ? (state === 'ready' ? 0 : totalSizeBytes)
      : Number(raw.downloadSizeBytes) || 0,
    version: String(raw.version ?? ''),
    message: raw.message == null ? null : String(raw.message),
  }
}

function safePrivateAiPhase(value: unknown): PrivateAiPublicProgress['phase'] {
  return value === 'checking' || value === 'downloading' || value === 'verifying' || value === 'extracting'
    ? value
    : null
}

function safePrivateAiProgress(value: unknown): PrivateAiPublicProgress {
  const raw = recordOf(value)
  return {
    state: safePrivateAiState(raw.state),
    phase: safePrivateAiPhase(raw.phase),
    percent: Number(raw.percent) || 0,
    fileIndex: Number(raw.fileIndex) || 0,
    fileCount: Number(raw.fileCount) || 0,
    fileName: raw.fileName == null ? null : String(raw.fileName),
    bytesDownloaded: Number(raw.bytesDownloaded) || 0,
    totalSizeBytes: Number(raw.totalSizeBytes) || 0,
    fileBytesDownloaded: Number(raw.fileBytesDownloaded) || 0,
    fileSizeBytes: Number(raw.fileSizeBytes) || 0,
    message: raw.message == null ? null : String(raw.message),
  }
}

function safeStoryIndexStatus(value: unknown): StoryIndexStatus {
  return value === 'not_indexed' || value === 'pending' || value === 'ready' || value === 'failed'
    ? value
    : 'not_indexed'
}

function safeStoryAnswer(value: unknown): StoryPublicAnswer | null {
  const raw = recordOf(value)
  try {
    const field = requireStoryField(raw.fieldKey)
    const language = normalizeStoryLanguage(raw.language).code
    return {
      fieldKey: field.key,
      section: field.section,
      label: String(raw.label ?? field.label),
      question: String(raw.question ?? field.prompt),
      answer: String(raw.answer ?? ''),
      language,
      confirmed: raw.confirmed === true,
      indexStatus: safeStoryIndexStatus(raw.indexStatus),
      updatedAt: Number(raw.updatedAt) || 0,
      confirmedAt: raw.confirmedAt == null ? null : Number(raw.confirmedAt) || 0,
    }
  } catch {
    return null
  }
}

function safeStoryState(value: unknown): StoryPublicState {
  const raw = recordOf(value)
  const answers = (Array.isArray(raw.answers) ? raw.answers : [])
    .map(safeStoryAnswer)
    .filter((answer): answer is StoryPublicAnswer => answer !== null)
  return { schemaVersion: 1, answers, confirmedCount: answers.filter((answer) => answer.confirmed).length }
}

function safeStoryHistory(value: unknown): StoryVersionSummary[] {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const raw = recordOf(item)
    const versionId = Number(raw.versionId)
    if (!Number.isSafeInteger(versionId) || versionId <= 0) return []
    return [{
      versionId,
      createdAt: Number(raw.createdAt) || 0,
      confirmedCount: Math.max(0, Math.floor(Number(raw.confirmedCount) || 0)),
    }]
  })
}

function safeStoryMediaItem(value: unknown): StoryMediaPublicItem | null {
  const raw = recordOf(value)
  const id = Number(raw.id)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  try {
    const fieldKey = requireStoryField(raw.fieldKey).key
    const mediaType = raw.mediaType === 'photo' || raw.mediaType === 'audio' ? raw.mediaType : null
    if (!mediaType) return null
    return {
      id,
      fieldKey,
      mediaType,
      fileName: String(raw.fileName ?? ''),
      mimeType: String(raw.mimeType ?? ''),
      sizeBytes: Math.max(0, Number(raw.sizeBytes) || 0),
      createdAt: Number(raw.createdAt) || 0,
    }
  } catch {
    return null
  }
}

function safeStoryMediaList(value: unknown): StoryMediaPublicItem[] {
  return (Array.isArray(value) ? value : [])
    .map(safeStoryMediaItem)
    .filter((item): item is StoryMediaPublicItem => item !== null)
}

function safeStoryMediaAdd(value: unknown): StoryMediaAddResult {
  const raw = recordOf(value)
  const items: StoryMediaAddResult['items'] = []
  for (const item of Array.isArray(raw.items) ? raw.items : []) {
    const safe = safeStoryMediaItem(item)
    if (safe) {
      items.push(safe)
      continue
    }
    const row = recordOf(item)
    const outcome = row.outcome === 'unsupported' || row.outcome === 'too-large' || row.outcome === 'failed'
      ? row.outcome
      : 'failed'
    items.push({ fileName: String(row.fileName ?? ''), outcome })
  }
  return { canceled: raw.canceled === true, items }
}

function safeTranscript(value: unknown): { transcript: string } {
  return { transcript: String(recordOf(value).transcript ?? '') }
}

function safeVoiceStatus(value: unknown): VoicePublicStatus {
  return safePrivateAiStatus(value)
}

function safeVoiceProgress(value: unknown): VoicePublicProgress {
  return safePrivateAiProgress(value)
}

function safeSpokenVoices(value: unknown): SpokenVoicePublic[] {
  return (Array.isArray(value) ? value : []).map((voice) => ({
    name: String(recordOf(voice).name ?? ''),
    language: String(recordOf(voice).language ?? ''),
  })).filter((voice) => voice.name && voice.language)
}

function safeSpeechResult(value: unknown): SpeechPublicResult {
  const raw = recordOf(value)
  if (raw.status === 'ok' && raw.wavBytes instanceof Uint8Array) {
    return { status: 'ok', wavBytes: new Uint8Array(raw.wavBytes), voiceName: String(raw.voiceName ?? '') }
  }
  return { status: raw.status === 'no-voice' ? 'no-voice' : 'unsupported' }
}

const PHOTO_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/

function safePhotoChoice(value: unknown): CirclePhotoChoice {
  const raw = recordOf(value)
  if (raw.status === 'saved' && typeof raw.dataUrl === 'string' && PHOTO_DATA_URL.test(raw.dataUrl)) {
    return { status: 'saved', personId: String(raw.personId ?? ''), dataUrl: raw.dataUrl }
  }
  if (raw.status === 'canceled' || raw.status === 'too-large') return { status: raw.status }
  return { status: 'unsupported' }
}

const noopSubscribe: Subscribe = () => () => undefined

function safeCatalog(value: unknown): GuardianAngelCatalogResult {
  const raw = recordOf(value)
  if (raw.status !== 'ready' || !Array.isArray(raw.templates) || typeof raw.fetchedAt !== 'number') return { status: 'unavailable' }
  return {
    status: 'ready',
    templates: raw.templates.filter(isGuardianAngelTemplate).map(publicTemplate),
    fetchedAt: raw.fetchedAt,
    stale: raw.stale === true,
  }
}

function safeViewTarget(value: PartnerViewTarget | undefined): PartnerViewTarget | undefined {
  if (!value) return undefined
  if (value.kind === 'template') return { kind: 'template', templateId: String(value.templateId) }
  if (value.kind === 'angel') return { kind: 'angel', angelId: String(value.angelId), page: value.page === 'run' ? 'run' : 'edit' }
  return { kind: value.kind }
}

function safeMyAngels(value: unknown): MyAngelsResult {
  const raw = recordOf(value)
  if (raw.status === 'ready' && Array.isArray(raw.angels)) {
    return { status: 'ready', angels: raw.angels.filter(isMyGuardianAngel).map(publicAngel) }
  }
  return raw.status === 'disconnected' ? { status: 'disconnected' } : { status: 'unavailable' }
}

function safeAddAngel(value: unknown): AddAngelResult {
  const raw = recordOf(value)
  if (raw.status === 'added' && isMyGuardianAngel(raw.angel)) return { status: 'added', angel: publicAngel(raw.angel) }
  return raw.status === 'disconnected' || raw.status === 'not-found' ? { status: raw.status } : { status: 'unavailable' }
}

function safeRemoveAngel(value: unknown): RemoveAngelResult {
  const status = recordOf(value).status
  return status === 'removed' || status === 'disconnected' || status === 'not-yours' ? { status } : { status: 'unavailable' }
}

function safeViewStatus(value: unknown): PartnerViewStatus | null {
  const raw = recordOf(value)
  if (!isPartnerServiceKey(raw.service)) return null
  const state = raw.state === 'loading' || raw.state === 'ready' || raw.state === 'failed' ? raw.state : 'failed'
  return { service: raw.service, state, canGoBack: raw.canGoBack === true }
}

export function createDesktopApi(invoke: Invoke, subscribe: Subscribe = noopSubscribe): DesktopApi {
  return {
    app: {
      async getVersion() {
        return String(await invoke('app:get-version'))
      },
      async getPlatform() {
        return String(await invoke('app:get-platform')) as NodeJS.Platform
      },
    },
    auth: {
      restore() {
        return invoke('auth:restore') as Promise<AuthState>
      },
      signIn(input: SignInInput) {
        return invoke('auth:sign-in', input) as Promise<AuthState>
      },
      checkInvitation(email: string) {
        return invoke('auth:check-invitation', email) as Promise<InvitationCheckResult>
      },
      register(input: RegisterInput) {
        return invoke('auth:register', input) as Promise<AuthState>
      },
      signOut() {
        return invoke('auth:sign-out') as Promise<{ success: true }>
      },
      requestPasswordReset(email: string) {
        return invoke('auth:request-password-reset', email) as Promise<{ success: true; message: string; expiresInMinutes: number }>
      },
      resetPassword(input: ResetPasswordInput) {
        return invoke('auth:reset-password', input) as Promise<{ success: true }>
      },
      updateProfile(name: string) {
        return invoke('auth:update-profile', name) as Promise<AuthState>
      },
      changePassword(input: ChangePasswordInput) {
        return invoke('auth:change-password', input) as Promise<AuthState>
      },
    },
    onboarding: {
      getState() {
        return invoke('onboarding:get-state') as Promise<AuthState>
      },
      setInitialPassword(newPassword: string) {
        return invoke('onboarding:set-initial-password', newPassword) as Promise<AuthState>
      },
      updateProfile(name: string) {
        return invoke('onboarding:update-profile', name) as Promise<AuthState>
      },
      getCircleContext() {
        return invoke('onboarding:get-circle-context') as Promise<CircleContext>
      },
      complete(nextAction: OnboardingNextAction) {
        return invoke('onboarding:complete', nextAction) as Promise<AuthState>
      },
    },
    circle: {
      getOverview() {
        return invoke('circle:get-overview') as Promise<CircleOverview>
      },
      getMyCircles() {
        return invoke('circle:get-my-circles') as Promise<CircleListItem[]>
      },
      getCircleDetails() {
        return invoke('circle:get-details') as Promise<CircleDetails | null>
      },
      selectCircle(circleId: string) {
        return invoke('circle:select', circleId) as Promise<{ success: true }>
      },
      createCircle(input: CreateCircleInput) {
        return invoke('circle:create', input) as Promise<CreateCircleResult>
      },
      inviteMember(input: InviteMemberInput) {
        return invoke('circle:invite-member', input) as Promise<InviteMemberResult>
      },
      addTreeRelation(input: AddTreeRelationInput) {
        return invoke('circle:add-tree-relation', input) as Promise<{ success: true }>
      },
      deleteTreeRelation(input: { relationId: string }) {
        return invoke('circle:delete-tree-relation', input) as Promise<{ success: true }>
      },
      saveTreePosition(input: SaveTreePositionInput) {
        return invoke('circle:save-tree-position', input) as Promise<{ success: true }>
      },
      markNotificationsRead() {
        return invoke('circle:mark-notifications-read') as Promise<{ success: true }>
      },
      resendInvitation(input: { personId: string }) {
        return invoke('circle:resend-invitation', input) as Promise<ResendInvitationResult>
      },
      cancelInvitation(input: { personId: string }) {
        return invoke('circle:cancel-invitation', input) as Promise<{ success: true }>
      },
      removeMember(input: { personId: string }) {
        return invoke('circle:remove-member', input) as Promise<{ success: true }>
      },
      leaveCircle() {
        return invoke('circle:leave') as Promise<{ success: true }>
      },
      async renameCircle(input: { name: string }) {
        await invoke('circle:rename', { name: String(input?.name ?? '') })
        return { success: true as const }
      },
      async deleteCircle(input: { confirmationName: string }) {
        await invoke('circle:delete', { confirmationName: String(input?.confirmationName ?? '') })
        return { success: true as const }
      },
      async listPhotos() {
        const raw = recordOf(await invoke('circle:photos-list'))
        return Object.fromEntries(Object.entries(raw)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && PHOTO_DATA_URL.test(entry[1])))
      },
      async choosePhoto(input: { personId: string }) {
        return safePhotoChoice(await invoke('circle:photo-choose', { personId: String(input?.personId ?? '') }))
      },
      async removePhoto(input: { personId: string }) {
        await invoke('circle:photo-remove', { personId: String(input?.personId ?? '') })
        return { success: true as const }
      },
    },
    vault: {
      async listDocuments() {
        const value = await invoke('vault:list')
        return (Array.isArray(value) ? value : []).map(safeSummary)
      },
      async chooseAndUploadDocuments() {
        return safeUploadBatch(await invoke('vault:choose-and-upload'))
      },
      openDocument(input: { documentId: number }) {
        return invoke('vault:open', { documentId: input.documentId }) as Promise<{ success: true }>
      },
      async retryExtraction(input: { documentId: number }) {
        return safeSummary(await invoke('vault:retry-extraction', { documentId: input.documentId }))
      },
      retryIndexing(input: { documentId: number }) {
        return invoke('vault:retry-indexing', { documentId: input.documentId }) as Promise<{ success: true }>
      },
      deleteDocument(input: { documentId: number }) {
        return invoke('vault:delete', { documentId: input.documentId }) as Promise<{ success: true }>
      },
      async ask(input: { question: string; scope: VaultQueryScope; language?: StoryLanguage }) {
        let language: StoryLanguage | undefined
        try { language = input.language ? normalizeStoryLanguage(input.language).code : undefined } catch { language = undefined }
        return safeAnswer(await invoke('vault:ask', {
          question: String(input.question ?? ''),
          scope: safeQueryScope(input.scope),
          ...(language ? { language } : {}),
        }))
      },
      onUploadProgress(listener: (progress: VaultUploadProgress) => void) {
        return subscribe('vault:upload-progress', (payload) => listener(safeProgress(payload)))
      },
    },
    settings: {
      async createBackup() {
        return safeBackupResult(await invoke('settings:create-backup'))
      },
      async openDataFolder() {
        await invoke('settings:open-data-folder')
        return { success: true as const }
      },
      async restoreBackup(): Promise<LocalRestoreResult> {
        const result = recordOf(await invoke('settings:restore-backup'))
        return result.canceled === false
          ? { canceled: false, restarting: true }
          : { canceled: true }
      },
    },
    privateAi: {
      async getStatus() {
        return safePrivateAiStatus(await invoke('private-ai:get-status'))
      },
      async startSetup() {
        return safePrivateAiStatus(await invoke('private-ai:start-setup'))
      },
      async pauseSetup() {
        return safePrivateAiStatus(await invoke('private-ai:pause-setup'))
      },
      async repair() {
        return safePrivateAiStatus(await invoke('private-ai:repair'))
      },
      async remove() {
        return safePrivateAiStatus(await invoke('private-ai:remove'))
      },
      onProgress(listener: (progress: PrivateAiPublicProgress) => void) {
        return subscribe('private-ai:progress', (payload) => listener(safePrivateAiProgress(payload)))
      },
    },
    story: {
      async get() {
        return safeStoryState(await invoke('story:get'))
      },
      async saveDraft(input) {
        return safeStoryState(await invoke('story:save-draft', {
          fieldKey: input.fieldKey,
          answer: String(input.answer ?? ''),
          language: input.language,
        }))
      },
      async confirmField(input) {
        return safeStoryState(await invoke('story:confirm-field', { fieldKey: input.fieldKey }))
      },
      async retryIndexing(input) {
        return safeStoryState(await invoke('story:retry-indexing', { fieldKey: input.fieldKey }))
      },
      async saveNow() {
        return safeStoryState(await invoke('story:save-now'))
      },
      async getHistory() {
        return safeStoryHistory(await invoke('story:get-history'))
      },
      async restoreVersion(input) {
        return safeStoryState(await invoke('story:restore-version', { versionId: input.versionId }))
      },
      async chooseAndAddMedia(input) {
        return safeStoryMediaAdd(await invoke('story:choose-add-media', { fieldKey: input.fieldKey, mediaType: input.mediaType }))
      },
      async listMedia() {
        return safeStoryMediaList(await invoke('story:list-media'))
      },
      openMedia(input) {
        return invoke('story:open-media', { mediaId: input.mediaId }) as Promise<{ success: true }>
      },
      deleteMedia(input) {
        return invoke('story:delete-media', { mediaId: input.mediaId }) as Promise<{ success: true }>
      },
      async transcribeRecording(input) {
        return safeTranscript(await invoke('story:transcribe-recording', {
          wavBytes: new Uint8Array(input.wavBytes),
          language: input.language,
        }))
      },
      async getVoiceStatus() {
        return safeVoiceStatus(await invoke('story:voice-status'))
      },
      async startVoiceSetup() {
        return safeVoiceStatus(await invoke('story:voice-start-setup'))
      },
      async pauseVoiceSetup() {
        return safeVoiceStatus(await invoke('story:voice-pause-setup'))
      },
      async repairVoiceSetup() {
        return safeVoiceStatus(await invoke('story:voice-repair-setup'))
      },
      onVoiceSetupProgress(listener: (progress: VoicePublicProgress) => void) {
        return subscribe('story:voice-setup-progress', (payload) => listener(safeVoiceProgress(payload)))
      },
    },
    speech: {
      async listVoices() {
        return safeSpokenVoices(await invoke('speech:list-voices'))
      },
      async synthesize(input) {
        return safeSpeechResult(await invoke('speech:synthesize', {
          text: String(input.text ?? ''),
          language: input.language,
        }))
      },
    },
    agentic: {
      async getCatalog(input) {
        return safeCatalog(await invoke('agentic:catalog', { refresh: input?.refresh === true }))
      },
      async openView(input) {
        const target = safeViewTarget(input.target)
        await invoke('agentic:open-view', target ? { service: input.service, target } : { service: input.service })
        return { success: true as const }
      },
      async setViewBounds(input) {
        await invoke('agentic:set-view-bounds', { service: input.service, x: input.x, y: input.y, width: input.width, height: input.height })
        return { success: true as const }
      },
      async hideView(input) {
        await invoke('agentic:hide-view', { service: input.service })
        return { success: true as const }
      },
      async viewCommand(input) {
        await invoke('agentic:view-command', { service: input.service, command: input.command })
        return { success: true as const }
      },
      onViewState(listener) {
        return subscribe('agentic:view-state', (payload) => {
          const status = safeViewStatus(payload)
          if (status) listener(status)
        })
      },
      async getAngelConnection() {
        return safeAngelConnection(await invoke('agentic:angel-connection'))
      },
      async connectAngels() {
        await invoke('agentic:connect')
        return { success: true as const }
      },
      async cancelConnectAngels() {
        await invoke('agentic:cancel-connect')
        return { success: true as const }
      },
      async disconnectAngels() {
        await invoke('agentic:disconnect')
        return { success: true as const }
      },
      async getMyAngels() {
        return safeMyAngels(await invoke('agentic:my-angels'))
      },
      async addAngel(input) {
        return safeAddAngel(await invoke('agentic:add-angel', { templateId: String(input.templateId) }))
      },
      async removeAngel(input) {
        return safeRemoveAngel(await invoke('agentic:remove-angel', { angelId: String(input.angelId) }))
      },
      onAngelConnection(listener) {
        return subscribe('agentic:angel-connection-changed', (payload) => listener(safeAngelConnection(payload)))
      },
      async openAngelChat(input) {
        return safeAngelChatOpen(await invoke('agentic:angel-chat-open', { angelId: String(input.angelId) }))
      },
      async sendAngelMessage(input) {
        return safeAngelChatSend(await invoke('agentic:angel-chat-send', { angelId: String(input.angelId), text: String(input.text) }))
      },
      async clearAngelChat(input) {
        await invoke('agentic:angel-chat-clear', { angelId: String(input.angelId) })
        return { success: true as const }
      },
    },
  }
}