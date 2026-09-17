import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outputPath = resolve(root, 'build', 'demo-mail-config.json')

function required(name) {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`${name} is required to build the demo mail transport`)
  return value
}

const enabled = required('SEND_EMAILS').toLowerCase() === 'true'
if (!enabled) throw new Error('SEND_EMAILS must be true to build the demo mail transport')

const url = new URL(required('MAIL_API_URL'))
if (url.protocol !== 'https:') throw new Error('MAIL_API_URL must use HTTPS')

const timeoutMs = Number(required('MAIL_API_TIMEOUT_MS'))
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error('MAIL_API_TIMEOUT_MS must be a positive integer')
}

const config = {
  enabled: true,
  url: url.toString(),
  timeoutMs,
  user: required('MAIL_API_USER'),
  password: required('MAIL_API_PASSWORD'),
}

mkdirSync(resolve(root, 'build'), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(config)}\n`, { encoding: 'utf8', mode: 0o600 })
console.log('Temporary demo mail config generated for packaging')
