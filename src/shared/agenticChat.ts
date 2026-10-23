import { TEMPLATE_ID } from './agentic'

export type AngelEscalationGroup = 'self-harm' | 'medical-emergency' | 'abuse' | 'confusion' | 'distress' | 'privacy'
const GROUPS: readonly AngelEscalationGroup[] = ['self-harm', 'medical-emergency', 'abuse', 'confusion', 'distress', 'privacy']

/** A My Story section an angel reply drew on. */
export interface AngelChatSource { label: string; excerpt: string }

export interface AngelChatMessage {
  id: number
  role: 'person' | 'angel'
  text: string
  sources: AngelChatSource[]
  /** Set when the message matched a safety trigger and got Family Circle's fixed reply. */
  escalation: AngelEscalationGroup | null
  /** ISO time in UTC. */
  createdAt: string
}

/** Where the angel runs: always Family Circle's own llama.cpp runtime. */
export interface AngelRuntimeInfo { backend: 'llama.cpp'; model: string }

export type AngelChatOpenResult =
  | { status: 'ready'; angel: { id: string; name: string }; runtime: AngelRuntimeInfo; messages: AngelChatMessage[]; offline: boolean }
  | { status: 'private-ai-needed' | 'connect-needed' | 'not-here' | 'unavailable' }

export type AngelChatSendResult =
  | { status: 'replied'; person: AngelChatMessage; reply: AngelChatMessage }
  | { status: 'private-ai-needed' | 'connect-needed' | 'not-here' | 'failed' }

export const MAX_ANGEL_MESSAGE = 1000

/** An angel with a copy saved on this computer. */
export interface SavedAngel { id: string; name: string }

/** A My Story section given to the angel's prompt. */
export interface StorySection { label: string; text: string }
/** One message of a local llama.cpp chat request. */
export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string }

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
}

function chatMessage(value: unknown): AngelChatMessage | null {
  const raw = record(value)
  const { id, role, createdAt, escalation } = raw
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || (role !== 'person' && role !== 'angel')) return null
  if (!text(raw.text, 4000) || !text(createdAt, 40) || !ISO_TIME.test(createdAt)) return null
  if (escalation !== null && !GROUPS.includes(escalation as AngelEscalationGroup)) return null
  if (!Array.isArray(raw.sources)) return null
  const sources: AngelChatSource[] = []
  for (const source of raw.sources.slice(0, 3)) {
    const entry = record(source)
    if (!text(entry.label, 200) || !text(entry.excerpt, 400)) return null
    sources.push({ label: entry.label, excerpt: entry.excerpt })
  }
  return { id, role, text: raw.text, sources, escalation: escalation as AngelEscalationGroup | null, createdAt }
}

export function safeAngelChatOpen(value: unknown): AngelChatOpenResult {
  const raw = record(value)
  if (raw.status === 'ready') {
    const angel = record(raw.angel)
    const runtime = record(raw.runtime)
    if (typeof angel.id !== 'string' || !TEMPLATE_ID.test(angel.id) || !text(angel.name, 120) || !angel.name) return { status: 'unavailable' }
    if (runtime.backend !== 'llama.cpp' || !text(runtime.model, 120) || !runtime.model) return { status: 'unavailable' }
    if (!Array.isArray(raw.messages) || typeof raw.offline !== 'boolean') return { status: 'unavailable' }
    const messages = raw.messages.map(chatMessage).filter((item): item is AngelChatMessage => item !== null)
    return { status: 'ready', angel: { id: angel.id, name: angel.name }, runtime: { backend: 'llama.cpp', model: runtime.model }, messages, offline: raw.offline }
  }
  return raw.status === 'private-ai-needed' || raw.status === 'connect-needed' || raw.status === 'not-here'
    ? { status: raw.status }
    : { status: 'unavailable' }
}

export function safeSavedAngels(value: unknown): SavedAngel[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).flatMap((item) => {
    const raw = record(item)
    return typeof raw.id === 'string' && TEMPLATE_ID.test(raw.id) && text(raw.name, 120) && raw.name
      ? [{ id: raw.id, name: raw.name }]
      : []
  })
}

export function safeAngelChatSend(value: unknown): AngelChatSendResult {
  const raw = record(value)
  if (raw.status === 'replied') {
    const person = chatMessage(raw.person)
    const reply = chatMessage(raw.reply)
    return person && reply ? { status: 'replied', person, reply } : { status: 'failed' }
  }
  return raw.status === 'private-ai-needed' || raw.status === 'connect-needed' || raw.status === 'not-here'
    ? { status: raw.status }
    : { status: 'failed' }
}
