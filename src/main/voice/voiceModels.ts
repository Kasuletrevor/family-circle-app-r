import type {
  OfflineAiManifest,
  OfflineAiManifestFile,
  PrivateAiStatus,
  PrivateAiProgress,
} from '../ai/privateAiModels'

export const VOICE_PACK_VERSION = 'whisper-v1.9.1-base-v1' as const

export const PINNED_VOICE_RUNTIME = Object.freeze({
  name: 'Whisper runtime',
  type: 'runtime',
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip',
  targetPath: 'runtime/whisper-v1.9.1-win-x64',
  sha256: '7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539',
  sizeBytes: 7_982_101,
  extract: true,
  required: true,
}) satisfies OfflineAiManifestFile

export const PINNED_VOICE_MODEL = Object.freeze({
  name: 'Whisper base model',
  type: 'model',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  targetPath: 'models/ggml-base.bin',
  sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
  sizeBytes: 147_951_465,
  extract: false,
  required: true,
}) satisfies OfflineAiManifestFile

export interface InstalledVoicePaths {
  runtimeDir: string
  executable: string
  model: string
}

export type VoiceStatus = PrivateAiStatus
export type VoiceProgress = PrivateAiProgress

const PINNED_FILES = [PINNED_VOICE_RUNTIME, PINNED_VOICE_MODEL] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isExactPinnedFile(value: unknown, pinned: OfflineAiManifestFile): value is OfflineAiManifestFile {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  const expectedKeys = ['extract','name','required','sha256','sizeBytes','targetPath','type','url'].sort()
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return false
  return value.name === pinned.name
    && value.type === pinned.type
    && value.url === pinned.url
    && value.targetPath === pinned.targetPath
    && value.sha256 === pinned.sha256
    && value.sizeBytes === pinned.sizeBytes
    && value.extract === pinned.extract
    && value.required === pinned.required
}

export function parseVoiceManifest(raw: string): OfflineAiManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Invalid offline voice manifest')
  }
  if (!isRecord(parsed)
    || parsed.version !== VOICE_PACK_VERSION
    || !Array.isArray(parsed.files)
    || parsed.files.length !== PINNED_FILES.length
    || !PINNED_FILES.every((pinned, index) => isExactPinnedFile(parsed.files[index], pinned))) {
    throw new Error('Invalid offline voice manifest')
  }
  return {
    version: VOICE_PACK_VERSION,
    files: [
      { ...PINNED_VOICE_RUNTIME },
      { ...PINNED_VOICE_MODEL },
    ],
  }
}
