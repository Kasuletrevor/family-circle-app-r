import type { DesktopApi, VoicePublicProgress } from '../../../shared/desktopApi'
import type { StoryFieldKey, StoryLanguage } from '../../../shared/story'
import type { StoryClient } from './StoryClient'

type StoryDesktopOperations = DesktopApi['story']

const defaultOperations: StoryDesktopOperations = {
  get: () => window.familyCircle.story.get(),
  saveDraft: (input) => window.familyCircle.story.saveDraft(input),
  confirmField: (input) => window.familyCircle.story.confirmField(input),
  retryIndexing: (input) => window.familyCircle.story.retryIndexing(input),
  saveNow: () => window.familyCircle.story.saveNow(),
  getHistory: () => window.familyCircle.story.getHistory(),
  restoreVersion: (input) => window.familyCircle.story.restoreVersion(input),
  chooseAndAddMedia: (input) => window.familyCircle.story.chooseAndAddMedia(input),
  listMedia: () => window.familyCircle.story.listMedia(),
  openMedia: (input) => window.familyCircle.story.openMedia(input),
  deleteMedia: (input) => window.familyCircle.story.deleteMedia(input),
  transcribeRecording: (input) => window.familyCircle.story.transcribeRecording(input),
  getVoiceStatus: () => window.familyCircle.story.getVoiceStatus(),
  startVoiceSetup: () => window.familyCircle.story.startVoiceSetup(),
  pauseVoiceSetup: () => window.familyCircle.story.pauseVoiceSetup(),
  repairVoiceSetup: () => window.familyCircle.story.repairVoiceSetup(),
  onVoiceSetupProgress: (listener) => window.familyCircle.story.onVoiceSetupProgress(listener),
}

export class DesktopStoryClient implements StoryClient {
  private readonly operations: StoryDesktopOperations

  constructor(operations: Partial<StoryDesktopOperations> = {}) {
    this.operations = { ...defaultOperations, ...operations }
  }

  get() {
    return this.operations.get()
  }

  saveDraft(fieldKey: StoryFieldKey, answer: string, language: StoryLanguage) {
    return this.operations.saveDraft({ fieldKey, answer, language })
  }

  confirmField(fieldKey: StoryFieldKey) {
    return this.operations.confirmField({ fieldKey })
  }

  retryIndexing(fieldKey: StoryFieldKey) {
    return this.operations.retryIndexing({ fieldKey })
  }

  saveNow() {
    return this.operations.saveNow()
  }

  getHistory() {
    return this.operations.getHistory()
  }

  restoreVersion(versionId: number) {
    return this.operations.restoreVersion({ versionId })
  }

  chooseAndAddMedia(fieldKey: StoryFieldKey, mediaType: 'photo' | 'audio') {
    return this.operations.chooseAndAddMedia({ fieldKey, mediaType })
  }

  listMedia() {
    return this.operations.listMedia()
  }

  openMedia(mediaId: number) {
    return this.operations.openMedia({ mediaId })
  }

  deleteMedia(mediaId: number) {
    return this.operations.deleteMedia({ mediaId })
  }

  transcribeRecording(wavBytes: Uint8Array, language: StoryLanguage) {
    return this.operations.transcribeRecording({ wavBytes, language })
  }

  getVoiceStatus() {
    return this.operations.getVoiceStatus()
  }

  startVoiceSetup() {
    return this.operations.startVoiceSetup()
  }

  pauseVoiceSetup() {
    return this.operations.pauseVoiceSetup()
  }

  repairVoiceSetup() {
    return this.operations.repairVoiceSetup()
  }

  onVoiceSetupProgress(listener: (progress: VoicePublicProgress) => void): () => void {
    return this.operations.onVoiceSetupProgress(listener)
  }
}
