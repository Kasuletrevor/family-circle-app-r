import { ModelArch, Transcriber } from '@moonshine-ai/moonshine-wasm'

const MODEL_BASE = 'https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_08_21'
const MODEL_FILES = [
  ['adapter.ort', 1319664],
  ['cross_kv.ort', 1287544],
  ['decoder_kv.ort', 32583720],
  ['encoder.ort', 7675440],
  ['frontend.model.ort', 23344],
  ['frontend.weights.ort', 2093464],
  ['streaming_config.json', 509],
  ['tokenizer.bin', 249974],
]
const TEST_AUDIO_URL = 'https://raw.githubusercontent.com/moonshine-ai/moonshine/main/test-assets/two_cities_16k.wav'
const EXPECTED_PHRASES = ['best of times', 'worst of times']

function report(message) {
  process.parentPort?.postMessage(message)
}

async function fetchExact(url, expectedBytes) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`download failed (${response.status}) for ${new URL(url).pathname}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) {
    throw new Error(`size mismatch for ${new URL(url).pathname}: expected ${expectedBytes}, got ${bytes.byteLength}`)
  }
  return bytes
}

function parsePcm16Wav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length))
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') {
    throw new Error('test audio is not a RIFF/WAVE file')
  }

  let offset = 12
  let format
  let dataOffset
  let dataLength
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(offset, 4)
    const length = view.getUint32(offset + 4, true)
    const payload = offset + 8
    if (id === 'fmt ') {
      format = {
        audioFormat: view.getUint16(payload, true),
        channels: view.getUint16(payload + 2, true),
        sampleRate: view.getUint32(payload + 4, true),
        bitsPerSample: view.getUint16(payload + 14, true),
      }
    } else if (id === 'data') {
      dataOffset = payload
      dataLength = length
      break
    }
    offset = payload + length + (length % 2)
  }

  if (!format || dataOffset === undefined || dataLength === undefined) {
    throw new Error('test WAV is missing fmt or data chunk')
  }
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new Error(`expected mono PCM16 WAV, got format=${format.audioFormat} channels=${format.channels} bits=${format.bitsPerSample}`)
  }

  const samples = new Float32Array(Math.floor(dataLength / 2))
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768
  }
  return { audio: samples, sampleRate: format.sampleRate }
}

function joinedText(transcript) {
  return transcript.lines.map((line) => line.text).join(' ').toLowerCase()
}

async function main() {
  const startedAt = performance.now()
  const downloadStartedAt = performance.now()
  const modelEntries = await Promise.all(
    MODEL_FILES.map(async ([name, expectedBytes]) => {
      const bytes = await fetchExact(`${MODEL_BASE}/${name}`, expectedBytes)
      return [name, bytes]
    }),
  )
  const downloadMs = performance.now() - downloadStartedAt
  const modelBytes = modelEntries.reduce((total, [, bytes]) => total + bytes.byteLength, 0)
  const files = Object.fromEntries(modelEntries)

  const wavBytes = await fetchExact(TEST_AUDIO_URL)
  const { audio, sampleRate } = parsePcm16Wav(wavBytes)
  if (sampleRate !== 16000) throw new Error(`expected 16 kHz test audio, got ${sampleRate}`)

  const loadStartedAt = performance.now()
  const transcriber = await Transcriber.load({
    files,
    modelArch: ModelArch.TinyStreaming,
  })
  const loadMs = performance.now() - loadStartedAt

  let stream
  try {
    const transcribeStartedAt = performance.now()
    stream = transcriber.createStream({ updateInterval: 0.5 })
    stream.start()

    const chunkSamples = 1600 // 100 ms at 16 kHz
    let pendingSamples = 0
    let passes = 0
    let firstPartialMs = null
    stream.addListener({
      onLineTextChanged: () => {
        if (firstPartialMs === null) firstPartialMs = performance.now() - transcribeStartedAt
      },
    })

    for (let i = 0; i < audio.length; i += chunkSamples) {
      const chunk = audio.subarray(i, Math.min(i + chunkSamples, audio.length))
      stream.addAudio(chunk, sampleRate)
      pendingSamples += chunk.length
      if (pendingSamples >= 8000) {
        stream.transcribe()
        passes += 1
        pendingSamples = 0
      }
    }

    const speechEndAt = performance.now()
    stream.stop()
    const final = stream.transcribe()
    const finalizedAt = performance.now()
    passes += 1
    const text = joinedText(final)
    const missing = EXPECTED_PHRASES.filter((phrase) => !text.includes(phrase))
    if (missing.length) {
      throw new Error(`transcript missed expected phrase(s): ${missing.join(', ')}; transcript=${JSON.stringify(text)}`)
    }

    const memory = process.memoryUsage()
    report({
      type: 'success',
      runtime: 'electron-utility-process',
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron,
      moonshineModel: 'tiny-streaming-en',
      modelBytes,
      modelMiB: Number((modelBytes / 1024 / 1024).toFixed(2)),
      audioSeconds: Number((audio.length / sampleRate).toFixed(2)),
      downloadMs: Math.round(downloadMs),
      loadMs: Math.round(loadMs),
      firstPartialMs: firstPartialMs === null ? null : Math.round(firstPartialMs),
      speechEndToFinalMs: Math.round(finalizedAt - speechEndAt),
      totalTranscribeMs: Math.round(finalizedAt - transcribeStartedAt),
      passes,
      transcript: text,
      rssMiB: Number((memory.rss / 1024 / 1024).toFixed(1)),
      heapUsedMiB: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
      totalMs: Math.round(performance.now() - startedAt),
    })
  } finally {
    stream?.close()
    transcriber.close()
  }
}

main().catch((error) => {
  report({
    type: 'failure',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })
  process.exitCode = 1
})
