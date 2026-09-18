import { describe, expect, it, vi } from 'vitest'
import { StoryVoiceRecorder } from './StoryVoiceRecorder'

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length))
}

function audioFixture() {
  const stop = vi.fn()
  const track = { stop }
  const stream = { getTracks: () => [track] }
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  const processor: {
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    onaudioprocess: ((event: { inputBuffer: { getChannelData(channel: number): Float32Array } }) => void) | null
  } = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null,
  }
  const close = vi.fn(async () => undefined)
  const context = {
    sampleRate: 48_000,
    destination: {},
    createMediaStreamSource: vi.fn(() => source),
    createScriptProcessor: vi.fn(() => processor),
    close,
  }
  return { stop, stream, source, processor, close, context }
}

describe('StoryVoiceRecorder', () => {
  it('emits a mono 16 kHz 16-bit PCM WAV and releases microphone/audio resources', async () => {
    const fixture = audioFixture()
    const getUserMedia = vi.fn(async () => fixture.stream as unknown as MediaStream)
    const recorder = new StoryVoiceRecorder({
      getUserMedia,
      createAudioContext: () => fixture.context as unknown as AudioContext,
    })

    await recorder.start()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { channelCount: 1 }, video: false })
    expect(recorder.isRecording()).toBe(true)

    fixture.processor.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array(480).fill(0.5),
      },
    })

    const wav = await recorder.stop()
    const header = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)

    expect(ascii(wav, 0, 4)).toBe('RIFF')
    expect(ascii(wav, 8, 4)).toBe('WAVE')
    expect(header.getUint16(22, true)).toBe(1)
    expect(header.getUint32(24, true)).toBe(16_000)
    expect(header.getUint16(34, true)).toBe(16)
    expect(header.getUint32(40, true)).toBe(320)
    expect(wav).toHaveLength(364)
    expect(recorder.isRecording()).toBe(false)
    expect(fixture.stop).toHaveBeenCalledTimes(1)
    expect(fixture.source.disconnect).toHaveBeenCalledTimes(1)
    expect(fixture.processor.disconnect).toHaveBeenCalledTimes(1)
    expect(fixture.close).toHaveBeenCalledTimes(1)
  })

  it('releases an acquired microphone track when audio setup fails', async () => {
    const fixture = audioFixture()
    const recorder = new StoryVoiceRecorder({
      getUserMedia: vi.fn(async () => fixture.stream as unknown as MediaStream),
      createAudioContext: () => {
        throw new Error('audio hardware failed')
      },
    })

    await expect(recorder.start()).rejects.toThrow('audio hardware failed')
    expect(fixture.stop).toHaveBeenCalledTimes(1)
    expect(recorder.isRecording()).toBe(false)
  })

  it('cancel always releases resources and produces no recording payload', async () => {
    const fixture = audioFixture()
    const recorder = new StoryVoiceRecorder({
      getUserMedia: vi.fn(async () => fixture.stream as unknown as MediaStream),
      createAudioContext: () => fixture.context as unknown as AudioContext,
    })

    await recorder.start()
    await recorder.cancel()

    expect(recorder.isRecording()).toBe(false)
    expect(fixture.stop).toHaveBeenCalledTimes(1)
    expect(fixture.close).toHaveBeenCalledTimes(1)
    await expect(recorder.stop()).rejects.toThrow('No Story voice recording is active')
  })
})
