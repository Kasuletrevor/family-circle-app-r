import type { SpeechPublicResult, SpokenVoicePublic } from '../../../shared/desktopApi'
import type { StoryLanguage } from '../../../shared/story'

/** Reads text aloud with the computer's own built-in voices. */
export interface SpeechClient {
  listVoices(): Promise<SpokenVoicePublic[]>
  synthesize(text: string, language: StoryLanguage): Promise<SpeechPublicResult>
}
