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
  VaultDocumentIssue,
  VaultDocumentSummary,
  VaultExtractionStatus,
  VaultFileType,
  VaultIndexStatus,
  VaultUploadBatchResult,
  VaultUploadOutcome,
  VaultUploadProgress,
  VaultUploadStage,
} from '../shared/desktopApi'

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
  | 'private-ai:get-status'
  | 'private-ai:start-setup'
  | 'private-ai:pause-setup'
  | 'private-ai:repair'

type Invoke = (channel: DesktopChannel, payload?: unknown) => Promise<unknown>
type DesktopEventChannel = 'vault:upload-progress' | 'private-ai:progress'
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
        return invoke('auth:request-password-reset', email) as Promise<{
          success: true
          message: string
          expiresInMinutes: number
        }>
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
  }
}
