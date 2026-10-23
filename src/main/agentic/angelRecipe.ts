import { cleanText, rules } from './catalogSanitizer'

export const MAX_INSTRUCTIONS = 4000
const KEY = /^[a-z0-9_]{1,64}$/
// Control, zero-width and bidi characters, but not the line feed: line breaks matter in instructions.
const UNSAFE_IN_INSTRUCTIONS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g

/** What Family Circle needs to run one of the person's angels locally. Never the marketplace model. */
export interface AngelRecipe {
  angelId: string
  name: string
  instructions: string
  tools: string[]
  trustBoundaries: string[]
  /** Raw trigger keys, such as "self_harm_mentions", matched against fixed word lists. */
  escalationKeys: string[]
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function keys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && KEY.test(item)))].slice(0, 20)
}

function cleanInstructions(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(UNSAFE_IN_INSTRUCTIONS, '').trim().slice(0, MAX_INSTRUCTIONS)
}

/** The export package (KinKeepersAgentPackage v1) in the shape the local runner uses, or null. */
export function sanitizeRecipe(angelId: string, raw: unknown): AngelRecipe | null {
  const pkg = record(raw)
  const name = cleanText(record(pkg.agent).name, 120)
  if (!name) return null
  const config = record(pkg.config)
  const safety = record(pkg.safety)
  return {
    angelId,
    name,
    instructions: cleanInstructions(config.instructions),
    tools: keys(config.tools),
    trustBoundaries: rules(safety.trust_boundaries),
    escalationKeys: keys(safety.escalation_triggers),
  }
}

/** For recipes read back from the local cache. */
export function isAngelRecipe(value: unknown): value is AngelRecipe {
  const raw = record(value)
  const strings = (list: unknown) => Array.isArray(list) && list.every((item) => typeof item === 'string')
  return typeof raw.angelId === 'string' && typeof raw.name === 'string' && raw.name.length > 0
    && typeof raw.instructions === 'string' && raw.instructions.length <= MAX_INSTRUCTIONS
    && strings(raw.tools) && strings(raw.trustBoundaries) && strings(raw.escalationKeys)
}
