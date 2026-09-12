import type {
  AuthState,
  CircleContext,
  CircleDetails,
  CircleListItem,
  CircleOverview,
  CreateCircleInput,
  CreateCircleResult,
  DesktopApi,
  InvitationCheckResult,
  InviteMemberInput,
  InviteMemberResult,
  OnboardingNextAction,
  PrivateAiPublicProgress,
  PrivateAiPublicState,
  PrivateAiPublicStatus,
  RegisterInput,
  ResendInvitationResult,
  ResetPasswordInput,
  SignInInput,
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
import { normalizeStoryLanguage, requireStoryField, type StoryIndexStatus } from '../shared/story'
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
  | 'circle:resend-invitation'
  | 'circle:cancel-invitation'
  | 'circle:remove-member'
  | 'circle:leave'
  | 'vault:list'
  | 'vault:choose-and-upload'
  | 'vault:open'
  | 'vault:retry-extraction'
  | 'vault:retry-indexing'
  | 'vault:delete'
  | 'vault:ask'
  | 'private-ai:get-status'
  | 'private-ai:start-setup'
  | 'private-ai:pause-setup'
  | 'private-ai:repair'
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

type Invoke = (channel: DesktopChannel, payload?: unknown) => Promise<unknown>
type DesktopEventChannel = 'vault:upload-progress' | 'private-ai:progress' | 'story:voice-setup-progress'
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
  }
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
    sources: sources.map((source) => {
      const row = recordOf(source)
      return {
        documentId: Number(row.documentId),
        fileName: String(row.fileName ?? ''),
        excerpt: String(row.excerpt ?? '').slice(0, 320),
      }
    }).filter((source) => Number.isSafeInteger(source.documentId) && source.documentId > 0),
  }
}

function safeQueryScope(scope: VaultQueryScope): VaultQueryScope {
  if (scope.type === 'all') return { type: 'all' }
  return {
    type: 'documents',
    documentIds: scope.documentIds.filter((id) => Number.isSafeInteger(id) && id > 0),
  }
}

function safePrivateAiStatus(value: unknown): PrivateAiPublicStatus {
  const raw = recordOf(value)
  const state = safePrivateAiState(raw.state)
  return {
    state,
    ready: raw.ready === true && state === 'ready',
    repairRequired: raw.repairRequired === true && state === 'repair_required',
    totalSizeBytes: Number(raw.totalSizeBytes) || 0,
    version: String(raw.version ?? ''),
    message: raw.message == null ? null : String(raw.message),
  }
}

function safePrivateAiProgress(value: unknown): PrivateAiPublicProgress {
  const raw = recordOf(value)
  return {
    state: safePrivateAiState(raw.state),
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

const noopSubscribe: Subscribe = () => () => undefined

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
      async ask(input: { question: string; scope: VaultQueryScope }) {
        return safeAnswer(await invoke('vault:ask', {
          question: String(input.question ?? ''),
          scope: safeQueryScope(input.scope),
        }))
      },
      onUploadProgress(listener: (progress: VaultUploadProgress) => void) {
        return subscribe('vault:upload-progress', (payload) => listener(safeProgress(payload)))
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
  }
}