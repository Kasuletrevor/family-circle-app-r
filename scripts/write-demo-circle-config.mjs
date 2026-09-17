import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outputPath = resolve(root, 'build', 'demo-circle-config.json')

function required(name) {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`${name} is required to build the demo Circle transport`)
  return value
}

const baseUrl = new URL(required('CIRCLE_API_URL'))
if (baseUrl.protocol !== 'https:') throw new Error('CIRCLE_API_URL must use HTTPS')

const config = {
  baseUrl: baseUrl.toString().replace(/\/+$/, ''),
  apiKey: required('CIRCLE_API_KEY'),
}

mkdirSync(resolve(root, 'build'), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(config)}\n`, { encoding: 'utf8', mode: 0o600 })
console.log('Temporary demo Circle config generated for packaging')
