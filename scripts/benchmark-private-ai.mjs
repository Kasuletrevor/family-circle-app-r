#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

const DEFAULT_ENDPOINTS = {
  fast: 'http://127.0.0.1:8082',
  complex: 'http://127.0.0.1:8080',
}

const MODEL_MAX_TOKENS = {
  fast: 192,
  complex: 384,
}

function usage(message) {
  console.error(message)
  console.error('Usage: node scripts/benchmark-private-ai.mjs --fixtures <fixtures.json> [--model fast|complex|both] [--fast-url http://127.0.0.1:8082] [--complex-url http://127.0.0.1:8080]')
}

function parseArgs(argv) {
  const options = {
    fixtures: '',
    model: 'both',
    fastUrl: DEFAULT_ENDPOINTS.fast,
    complexUrl: DEFAULT_ENDPOINTS.complex,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--fixtures' && value) {
      options.fixtures = value
      index += 1
    } else if (flag === '--model' && value) {
      options.model = value
      index += 1
    } else if (flag === '--fast-url' && value) {
      options.fastUrl = value
      index += 1
    } else if (flag === '--complex-url' && value) {
      options.complexUrl = value
      index += 1
    } else if (flag === '--help' || flag === '-h') {
      usage('Private AI benchmark harness')
      process.exit(0)
    } else {
      throw new Error(`Unknown or incomplete argument: ${flag ?? ''}`)
    }
  }

  if (!options.fixtures) throw new Error('--fixtures is required')
  if (!['fast', 'complex', 'both'].includes(options.model)) {
    throw new Error('--model must be fast, complex, or both')
  }
  requireLoopback(options.fastUrl)
  requireLoopback(options.complexUrl)
  return options
}

function requireLoopback(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('Private AI benchmark endpoints must use http://127.0.0.1 loopback')
  }
  return url.toString().replace(/\/$/, '')
}

function normalizedList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function containsAll(text, terms) {
  const haystack = text.toLocaleLowerCase()
  return terms.every((term) => haystack.includes(term.toLocaleLowerCase()))
}

function containsNone(text, terms) {
  const haystack = text.toLocaleLowerCase()
  return terms.every((term) => !haystack.includes(term.toLocaleLowerCase()))
}

function scoreAnswer(fixture, answer) {
  const expectedIncludes = normalizedList(fixture.expectedIncludes)
  const groundingIncludes = normalizedList(fixture.groundingIncludes)
  const forbiddenIncludes = normalizedList(fixture.forbiddenIncludes)

  const correct = expectedIncludes.length > 0
    ? containsAll(answer, expectedIncludes)
    : null

  const hasGroundingRule = groundingIncludes.length > 0 || forbiddenIncludes.length > 0
  const grounded = hasGroundingRule
    ? containsAll(answer, groundingIncludes) && containsNone(answer, forbiddenIncludes)
    : null

  return { correct, grounded }
}

function validateFixture(raw, index) {
  if (!raw || typeof raw !== 'object') throw new Error(`Fixture ${index + 1} must be an object`)
  const caseId = String(raw.caseId ?? '').trim()
  const question = String(raw.question ?? '').trim()
  const context = String(raw.context ?? '').trim()
  if (!caseId || !question || !context) {
    throw new Error(`Fixture ${index + 1} requires caseId, question, and context`)
  }
  return { ...raw, caseId, question, context }
}

async function readFixtures(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'))
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Benchmark fixtures must be a non-empty JSON array')
  }
  return parsed.map(validateFixture)
}

function parseSseEvent(block) {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')
  if (!data || data === '[DONE]') return null
  return JSON.parse(data)
}

function deltaText(event) {
  const choices = event?.choices
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const delta = choices[0]?.delta
  return typeof delta?.content === 'string' ? delta.content : ''
}

async function streamCompletion({ endpoint, model, fixture }) {
  const startedAt = performance.now()
  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: 'Answer using ONLY the provided private source context. If the answer is unsupported, say you could not find it in the selected private sources.',
        },
        {
          role: 'user',
          content: `Private source context:\n${fixture.context}\n\nQuestion:\n${fixture.question}`,
        },
      ],
      max_tokens: MODEL_MAX_TOKENS[model],
      temperature: 0,
      top_k: 40,
      top_p: 0.95,
      stream: true,
      stream_options: { include_usage: true },
    }),
  })

  if (!response.ok || !response.body) {
    throw new Error(`Local ${model} endpoint returned HTTP ${response.status}`)
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let answer = ''
  let firstTokenMs = null
  let generatedTokens = null

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const event = parseSseEvent(block)
      if (!event) continue
      const text = deltaText(event)
      if (text) {
        if (firstTokenMs === null) firstTokenMs = performance.now() - startedAt
        answer += text
      }
      const completionTokens = event?.usage?.completion_tokens
      if (Number.isFinite(completionTokens)) generatedTokens = Number(completionTokens)
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    const event = parseSseEvent(buffer)
    if (event) {
      const text = deltaText(event)
      if (text) {
        if (firstTokenMs === null) firstTokenMs = performance.now() - startedAt
        answer += text
      }
      const completionTokens = event?.usage?.completion_tokens
      if (Number.isFinite(completionTokens)) generatedTokens = Number(completionTokens)
    }
  }

  const totalMs = performance.now() - startedAt
  const quality = scoreAnswer(fixture, answer)
  return {
    caseId: fixture.caseId,
    model,
    firstTokenMs,
    totalMs,
    generatedTokens,
    // The model servers are separate processes. Do not mislabel this harness process RSS as model RSS.
    peakRssBytes: null,
    correct: quality.correct,
    grounded: quality.grounded,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const fixtures = await readFixtures(options.fixtures)
  const models = options.model === 'both' ? ['fast', 'complex'] : [options.model]
  const endpoints = {
    fast: requireLoopback(options.fastUrl),
    complex: requireLoopback(options.complexUrl),
  }

  for (const fixture of fixtures) {
    for (const model of models) {
      const result = await streamCompletion({
        endpoint: endpoints[model],
        model,
        fixture,
      })
      process.stdout.write(`${JSON.stringify(result)}\n`)
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Private AI benchmark failed'
  usage(message)
  process.exitCode = 1
})
