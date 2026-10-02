import type { DesktopApi } from '../../../shared/desktopApi'
import type { StoryLanguage } from '../../../shared/story'
import type { SpeechClient } from './SpeechClient'

type SpeechDesktopOperations = DesktopApi['speech']

const defaultOperations: SpeechDesktopOperations = {
  listVoices: () => window.familyCircle.speech.listVoices(),
  synthesize: (input) => window.familyCircle.speech.synthesize(input),
}

export class DesktopSpeechClient implements SpeechClient {
  private readonly operations: SpeechDesktopOperations

  constructor(operations: Partial<SpeechDesktopOperations> = {}) {
    this.operations = { ...defaultOperations, ...operations }
  }

  listVoices() {
    return this.operations.listVoices()
  }

  synthesize(text: string, language: StoryLanguage) {
    return this.operations.synthesize({ text, language })
  }
}
