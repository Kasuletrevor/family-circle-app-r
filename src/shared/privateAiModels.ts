/**
 * The local models Family Circle uses, as shown to people. Kept in step with
 * config/offline-ai-manifest.json and config/offline-voice-manifest.json by
 * privateAiModels.test.ts.
 */
export const PRIVATE_AI_MODELS = {
  answers: 'Qwen3.5 0.8B',
  search: 'Nomic Embed Text v1.5',
  voice: 'Whisper base',
} as const
