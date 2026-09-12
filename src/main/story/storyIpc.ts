import type {
  StoryMediaAddResult,
  StoryMediaPublicItem,
  VoicePublicProgress,
  VoicePublicStatus,
} from '../../shared/desktopApi'
import { normalizeStoryLanguage, requireStoryField, type StoryFieldKey, type StoryIndexStatus } from '../../shared/story'
import type { StoryPublicAnswer, StoryPublicState, StoryVersionSummary } from '../../shared/storyPublic'
import type { IpcHandleRegistrar } from '../auth/authIpc'
import { MAX_VOICE_WAV_BYTES } from '../voice/VoiceTranscriptionService'
import { VOICE_PACK_VERSION, type VoiceProgress, type VoiceStatus } from '../voice/voiceModels'
import type { StoryMediaAddResult as InternalStoryMediaAddResult, StoryMediaPublicItem as InternalStoryMediaPublicItem } from './StoryMediaService'

export interface StoryIpcService {
  get(): Promise<StoryPublicState>
  saveDraft(input: { fieldKey: StoryFieldKey; answer: string; language: ReturnType<typeof normalizeStoryLanguage>['code'] }): Promise<StoryPublicState>
  confirmField(input: { fieldKey: StoryFieldKey }): Promise<StoryPublicState>
  retryIndexing(input: { fieldKey: StoryFieldKey }): Promise<StoryPublicState>
  saveNow(): Promise<StoryPublicState>
  getHistory(): Promise<StoryVersionSummary[]>
  restoreVersion(input: { versionId: number }): Promise<StoryPublicState>
}

export interface StoryMediaIpcService {
  chooseAndAdd(input: { fieldKey: StoryFieldKey; mediaType: 'photo' | 'audio' }): Promise<InternalStoryMediaAddResult>
  list(): Promise<InternalStoryMediaPublicItem[]>
  open(input: { mediaId: number }): Promise<{ success: true }>
  delete(input: { mediaId: number }): Promise<{ success: true }>
}

export interface StoryVoiceAssetIpcService {
  getStatus(): Promise<VoiceStatus>
  startSetup(onProgress?: (progress: VoiceProgress) => void): Promise<VoiceStatus>
  pauseSetup(): VoiceStatus | null
  repair(onProgress?: (progress: VoiceProgress) => void): Promise<VoiceStatus>
}

export interface StoryTranscriptionIpcService {
  transcribe(input: { wavBytes: Uint8Array; language: ReturnType<typeof normalizeStoryLanguage>['code'] }): Promise<{ transcript: string }>
}

interface StoryIpcDependencies {
  story: StoryIpcService
  media: StoryMediaIpcService
  voiceAssets: StoryVoiceAssetIpcService
  transcription: StoryTranscriptionIpcService
}

interface StoryIpcEvent {
  sender?: { send(channel: string, payload: unknown): void }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function safeFieldKey(value: unknown): StoryFieldKey {
  return requireStoryField(value).key
}

function safeIndexStatus(value: unknown): StoryIndexStatus {
  return value === 'not_indexed' || value === 'pending' || value === 'ready' || value === 'failed'
    ? value
    : 'not_indexed'
}

function finiteNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function safeAnswer(value: unknown): StoryPublicAnswer | null {
  const raw = recordOf(value)
  try {
    const field = requireStoryField(raw.fieldKey)
    const language = normalizeStoryLanguage(raw.language).code
    const confirmedAt = raw.confirmedAt == null ? null : finiteNumber(raw.confirmedAt)
    return {
      fieldKey: field.key,
      section: field.section,
      label: String(raw.label ?? field.label),
      question: String(raw.question ?? field.prompt),
      answer: String(raw.answer ?? ''),
      language,
      confirmed: raw.confirmed === true,
      indexStatus: safeIndexStatus(raw.indexStatus),
      updatedAt: finiteNumber(raw.updatedAt),
      confirmedAt,
    }
  } catch {
    return null
  }
}

function safeStoryState(value: unknown): StoryPublicState {
  const raw = recordOf(value)
  const answers = (Array.isArray(raw.answers) ? raw.answers : [])
    .map(safeAnswer)
    .filter((answer): answer is StoryPublicAnswer => answer !== null)
  return {
    schemaVersion: 1,
    answers,
    confirmedCount: answers.filter((answer) => answer.confirmed).length,
  }
}

function safeHistory(value: unknown): StoryVersionSummary[] {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const raw = recordOf(item)
    const versionId = Number(raw.versionId)
    if (!Number.isSafeInteger(versionId) || versionId <= 0) return []
    return [{
      versionId,
      createdAt: finiteNumber(raw.createdAt),
      confirmedCount: Math.max(0, Math.floor(finiteNumber(raw.confirmedCount))),
    }]
  })
}

function safeMediaItem(value: unknown): StoryMediaPublicItem | null {
  const raw = recordOf(value)
  const id = Number(raw.id)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  try {
    const fieldKey = safeFieldKey(raw.fieldKey)
    const mediaType = raw.mediaType === 'audio' ? 'audio' : raw.mediaType === 'photo' ? 'photo' : null
    if (!mediaType) return null
    return {
      id,
      fieldKey,
      mediaType,
      fileName: String(raw.fileName ?? ''),
      mimeType: String(raw.mimeType ?? ''),
      sizeBytes: Math.max(0, finiteNumber(raw.sizeBytes)),
      createdAt: finiteNumber(raw.createdAt),
    }
  } catch {
    return null
  }
}

function safeMediaList(value: unknown): StoryMediaPublicItem[] {
  return (Array.isArray(value) ? value : [])
    .map(safeMediaItem)
    .filter((item): item is StoryMediaPublicItem => item !== null)
}

function safeMediaAdd(value: unknown): StoryMediaAddResult {
  const raw = recordOf(value)
  const items: StoryMediaAddResult['items'] = []
  for (const item of Array.isArray(raw.items) ? raw.items : []) {
    const safe = safeMediaItem(item)
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

function safeVoiceState(value: unknown): VoicePublicStatus['state'] {
  return value === 'not_installed' || value === 'downloading' || value === 'paused' || value === 'verifying'
    || value === 'ready' || value === 'repair_required' || value === 'failed'
    ? value
    : 'failed'
}

function publicVoiceStatus(value: unknown): VoicePublicStatus {
  const raw = recordOf(value)
  const state = safeVoiceState(raw.state)
  return {
    state,
    ready: state === 'ready',
    repairRequired: state === 'repair_required',
    totalSizeBytes: Math.max(0, finiteNumber(raw.totalBytes)),
    version: VOICE_PACK_VERSION,
    message: raw.message == null ? null : String(raw.message),
  }
}

function publicVoiceProgress(value: unknown): VoicePublicProgress {
  const raw = recordOf(value)
  return {
    state: safeVoiceState(raw.state),
    percent: Math.max(0, Math.min(100, finiteNumber(raw.percent))),
    fileIndex: Math.max(0, Math.floor(finiteNumber(raw.fileIndex))),
    fileCount: Math.max(0, Math.floor(finiteNumber(raw.fileCount))),
    fileName: raw.fileName == null ? null : String(raw.fileName),
    bytesDownloaded: Math.max(0, finiteNumber(raw.bytesDownloaded)),
    totalSizeBytes: Math.max(0, finiteNumber(raw.totalBytes)),
    fileBytesDownloaded: Math.max(0, finiteNumber(raw.fileBytesDownloaded)),
    fileSizeBytes: Math.max(0, finiteNumber(raw.fileSizeBytes)),
    message: raw.message == null ? null : String(raw.message),
  }
}

function recordInput(payload: unknown): Record<string, unknown> {
  return recordOf(payload)
}

function versionIdOf(payload: unknown): number {
  return Number(recordInput(payload).versionId)
}

function mediaIdOf(payload: unknown): number {
  return Number(recordInput(payload).mediaId)
}

function recordingInputOf(payload: unknown): { wavBytes: Uint8Array; language: ReturnType<typeof normalizeStoryLanguage>['code'] } {
  const raw = recordInput(payload)
  const wavBytes = raw.wavBytes
  if (!(wavBytes instanceof Uint8Array) || wavBytes.byteLength > MAX_VOICE_WAV_BYTES) {
    throw new Error('Voice recording is invalid')
  }
  return { wavBytes: new Uint8Array(wavBytes), language: normalizeStoryLanguage(raw.language).code }
}

function senderOf(event: unknown): StoryIpcEvent['sender'] {
  return (event as StoryIpcEvent | null)?.sender
}

export function registerStoryIpc(ipc: IpcHandleRegistrar, dependencies: StoryIpcDependencies): void {
  ipc.handle('story:get', async () => safeStoryState(await dependencies.story.get()))
  ipc.handle('story:save-draft', async (_event, payload) => {
    const raw = recordInput(payload)
    return safeStoryState(await dependencies.story.saveDraft({
      fieldKey: safeFieldKey(raw.fieldKey),
      answer: typeof raw.answer === 'string' ? raw.answer : '',
      language: normalizeStoryLanguage(raw.language).code,
    }))
  })
  ipc.handle('story:confirm-field', async (_event, payload) => safeStoryState(await dependencies.story.confirmField({ fieldKey: safeFieldKey(recordInput(payload).fieldKey) })))
  ipc.handle('story:retry-indexing', async (_event, payload) => safeStoryState(await dependencies.story.retryIndexing({ fieldKey: safeFieldKey(recordInput(payload).fieldKey) })))
  ipc.handle('story:save-now', async () => safeStoryState(await dependencies.story.saveNow()))
  ipc.handle('story:get-history', async () => safeHistory(await dependencies.story.getHistory()))
  ipc.handle('story:restore-version', async (_event, payload) => safeStoryState(await dependencies.story.restoreVersion({ versionId: versionIdOf(payload) })))
  ipc.handle('story:choose-add-media', async (_event, payload) => {
    const raw = recordInput(payload)
    const mediaType = raw.mediaType === 'audio' ? 'audio' : raw.mediaType === 'photo' ? 'photo' : (() => { throw new Error('Invalid Story media type') })()
    return safeMediaAdd(await dependencies.media.chooseAndAdd({ fieldKey: safeFieldKey(raw.fieldKey), mediaType }))
  })
  ipc.handle('story:list-media', async () => safeMediaList(await dependencies.media.list()))
  ipc.handle('story:open-media', (_event, payload) => dependencies.media.open({ mediaId: mediaIdOf(payload) }))
  ipc.handle('story:delete-media', (_event, payload) => dependencies.media.delete({ mediaId: mediaIdOf(payload) }))
  ipc.handle('story:transcribe-recording', async (_event, payload) => {
    const result = await dependencies.transcription.transcribe(recordingInputOf(payload))
    return { transcript: String(recordOf(result).transcript ?? '') }
  })
  ipc.handle('story:voice-status', async () => publicVoiceStatus(await dependencies.voiceAssets.getStatus()))
  ipc.handle('story:voice-start-setup', async (event) => {
    const result = await dependencies.voiceAssets.startSetup((progress) => senderOf(event)?.send('story:voice-setup-progress', publicVoiceProgress(progress)))
    return publicVoiceStatus(result)
  })
  ipc.handle('story:voice-pause-setup', async () => {
    const paused = dependencies.voiceAssets.pauseSetup()
    return publicVoiceStatus(paused ?? await dependencies.voiceAssets.getStatus())
  })
  ipc.handle('story:voice-repair-setup', async (event) => {
    const result = await dependencies.voiceAssets.repair((progress) => senderOf(event)?.send('story:voice-setup-progress', publicVoiceProgress(progress)))
    return publicVoiceStatus(result)
  })
}
