const requiredNames = [
  'SEND_EMAILS',
  'MAIL_API_URL',
  'MAIL_API_TIMEOUT_MS',
  'MAIL_API_USER',
  'MAIL_API_PASSWORD',
]

const missing = requiredNames.filter((name) => !String(process.env[name] ?? '').trim())
const errors = []

if (missing.length > 0) {
  errors.push(`Missing required mail API configuration: ${missing.join(', ')}`)
}

if (String(process.env.SEND_EMAILS ?? '').trim() !== 'true') {
  errors.push('SEND_EMAILS must be exactly true for CI mail configuration verification')
}

const rawUrl = String(process.env.MAIL_API_URL ?? '').trim()
if (rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:') errors.push('MAIL_API_URL must use HTTPS')
  } catch {
    errors.push('MAIL_API_URL must be a valid URL')
  }
}

const rawTimeout = String(process.env.MAIL_API_TIMEOUT_MS ?? '').trim()
if (rawTimeout) {
  const timeoutMs = Number(rawTimeout)
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    errors.push('MAIL_API_TIMEOUT_MS must be a positive integer')
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error)
  process.exitCode = 1
} else {
  console.log('Mail API CI configuration verified')
}
