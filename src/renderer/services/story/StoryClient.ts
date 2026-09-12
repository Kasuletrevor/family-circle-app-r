import type {
  StoryMediaAddResult,
  StoryMediaPublicItem,
  VoicePublicProgress,
  VoicePublicStatus,
} from '../../../shared/desktopApi'
import type { StoryFieldKey, StoryLanguage } from '../../../shared/story'
import type { StoryPublicState, StoryVersionSummary } from '../../../shared/storyPublic'

export interface StoryClient {
  get(): Promise<StoryPublicState>
  saveDraft(fieldKey: StoryFieldKey, answer: string, language: StoryLanguage): Promise<StoryPublicState>
  confirmField(fieldKey: StoryFieldKey): Promise<StoryPublicState>
  retryIndexing(fieldKey: StoryFieldKey): Promise<StoryPublicState>
  saveNow(): Promise<StoryPublicState>
  getHistory(): Promise<StoryVersionSummary[]>
  restoreVersion(versionId: number): Promise<StoryPublicState>
  chooseAndAddMedia(fieldKey: StoryFieldKey, mediaType: 'photo' | 'audio'): Promise<StoryMediaAddResult>
  listMedia(): Promise<StoryMediaPublicItem[]>
  openMedia(mediaId: number): Promise<{ success: true }>
  deleteMedia(mediaId: number): Promise<{ success: true }>
  transcribeRecording(wavBytes: Uint8Array, language: StoryLanguage): Promise<{ transcript: string }>
  getVoiceStatus(): Promise<VoicePublicStatus>
  startVoiceSetup(): Promise<VoicePublicStatus>
  pauseVoiceSetup(): Promise<VoicePublicStatus>
  repairVoiceSetup(): Promise<VoicePublicStatus>
  onVoiceSetupProgress(listener: (progress: VoicePublicProgress) => void): () => void
}
