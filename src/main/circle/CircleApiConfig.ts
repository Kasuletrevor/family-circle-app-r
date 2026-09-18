import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { LegacyCircleAuthAdapterConfig } from './LegacyCircleAuthAdapter'

type Environment = NodeJS.ProcessEnv

type EmbeddedCircleConfig = {
  baseUrl: string
  apiKey: string
}

const DEMO_CIRCLE_CONFIG_FILENAME = 'demo-circle-config.json'

function embeddedDemoCircleConfig(): EmbeddedCircleConfig | null {
  const resourcesPath = String((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '').trim()
  if (!resourcesPath) return null

  const configPath = resolve(resourcesPath, DEMO_CIRCLE_CONFIG_FILENAME)
  if (!existsSync(configPath)) return null

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<EmbeddedCircleConfig>
    const baseUrl = String(parsed.baseUrl ?? '').trim().replace(/\/+$/, '')
    const apiKey = String(parsed.apiKey ?? '').trim()
    if (!baseUrl || !apiKey) return null

    const url = new URL(baseUrl)
    if (url.protocol !== 'https:') return null

    return { baseUrl: url.toString().replace(/\/+$/, ''), apiKey }
  } catch {
    return null
  }
}

export function resolveCircleApiConfig(env: Environment = process.env): LegacyCircleAuthAdapterConfig {
  const embedded = embeddedDemoCircleConfig()
  const baseUrl = String(env.CIRCLE_API_URL ?? '').trim() || embedded?.baseUrl || ''
  const apiKey = String(env.CIRCLE_API_KEY ?? '').trim() || embedded?.apiKey || ''
  return { baseUrl, apiKey }
}
