export interface StoryVoiceRecorderLike {
  start(): Promise<void>
  stop(): Promise<Uint8Array>
  cancel(): Promise<void>
  isRecording(): boolean
}

interface StoryVoiceRecorderDependencies {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createAudioContext?: () => AudioContext
}

function defaultGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture is unavailable')
  }
  return navigator.mediaDevices.getUserMedia(constraints)
}

function defaultAudioContext(): AudioContext {
  return new AudioContext()
}

function concatSamples(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function resampleMono(input: Float32Array, sourceRate: number, targetRate = 16_000): Float32Array {
  if (input.length === 0) return new Float32Array(0)
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) throw new Error('Invalid microphone sample rate')
  if (sourceRate === targetRate) return input.slice()

  const targetLength = Math.max(1, Math.round(input.length * targetRate / sourceRate))
  const output = new Float32Array(targetLength)
  const ratio = sourceRate / targetRate
  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * ratio
    const leftIndex = Math.min(input.length - 1, Math.floor(sourcePosition))
    const rightIndex = Math.min(input.length - 1, leftIndex + 1)
    const mix = sourcePosition - leftIndex
    output[index] = input[leftIndex] * (1 - mix) + input[rightIndex] * mix
  }
  return output
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

export function encodeMonoPcmWav(samples: Float32Array, sampleRate = 16_000): Uint8Array {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample))
    const pcm = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff)
    view.setInt16(offset, pcm, true)
    offset += 2
  }

  return new Uint8Array(buffer)
}

export class StoryVoiceRecorder implements StoryVoiceRecorderLike {
  private readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  private readonly createAudioContext: () => AudioContext
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private chunks: Float32Array[] = []
  private sampleRate = 16_000
  private recording = false

  constructor(dependencies: StoryVoiceRecorderDependencies = {}) {
    this.getUserMedia = dependencies.getUserMedia ?? defaultGetUserMedia
    this.createAudioContext = dependencies.createAudioContext ?? defaultAudioContext
  }

  isRecording(): boolean {
    return this.recording
  }

  async start(): Promise<void> {
    if (this.recording) throw new Error('Story voice recording is already active')
    this.chunks = []

    try {
      this.stream = await this.getUserMedia({ audio: { channelCount: 1 }, video: false })
      this.context = this.createAudioContext()
      this.sampleRate = this.context.sampleRate
      this.source = this.context.createMediaStreamSource(this.stream)
      this.processor = this.context.createScriptProcessor(4096, 1, 1)
      this.processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        this.chunks.push(new Float32Array(input))
      }
      this.source.connect(this.processor)
      this.processor.connect(this.context.destination)
      this.recording = true
    } catch (error) {
      this.recording = false
      await this.releaseResources()
      throw error
    }
  }

  async stop(): Promise<Uint8Array> {
    if (!this.recording) throw new Error('No Story voice recording is active')
    this.recording = false
    const chunks = this.chunks
    const sourceRate = this.sampleRate
    this.chunks = []

    await this.releaseResources()
    const mono = concatSamples(chunks)
    const resampled = resampleMono(mono, sourceRate, 16_000)
    return encodeMonoPcmWav(resampled, 16_000)
  }

  async cancel(): Promise<void> {
    this.recording = false
    this.chunks = []
    await this.releaseResources()
  }

  private async releaseResources(): Promise<void> {
    if (this.processor) {
      this.processor.onaudioprocess = null
      try { this.processor.disconnect() } catch { /* already disconnected */ }
      this.processor = null
    }
    if (this.source) {
      try { this.source.disconnect() } catch { /* already disconnected */ }
      this.source = null
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try { track.stop() } catch { /* best-effort release */ }
      }
      this.stream = null
    }
    if (this.context) {
      const context = this.context
      this.context = null
      try { await context.close() } catch { /* best-effort release */ }
    }
  }
}
