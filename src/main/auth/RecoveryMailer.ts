export interface RecoveryMailer {
  sendCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void>
  sendChangedNotice(input: { to: string }): Promise<void>
}

type Environment = NodeJS.ProcessEnv

const DEFAULT_MAIL_API_URL = 'https://elderchatgpt.com/memorytest/api/send-mail/'
const DEFAULT_MAIL_API_TIMEOUT_MS = 45_000

function envValue(env: Environment, ...names: string[]): string {
  for (const name of names) {
    const value = String(env[name] ?? '').trim()
    if (value) return value
  }
  return ''
}

function emailEnabled(env: Environment): boolean {
  return String(env.SEND_EMAILS ?? '').trim().toLowerCase() === 'true'
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

function apiConfig(env: Environment): { url: string; authorization: string; timeoutMs: number } {
  const url = envValue(env, 'MAIL_API_URL') || DEFAULT_MAIL_API_URL
  const user = envValue(env, 'MAIL_API_USER')
  const password = envValue(env, 'MAIL_API_PASSWORD')
  if (!user || !password) throw new Error('Mail API configuration is incomplete')

  const configuredTimeout = Number(envValue(env, 'MAIL_API_TIMEOUT_MS') || DEFAULT_MAIL_API_TIMEOUT_MS)
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_MAIL_API_TIMEOUT_MS

  return {
    url,
    authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    timeoutMs,
  }
}

async function postMail(env: Environment, input: { to: string; subject: string; body: string; html: string }): Promise<void> {
  const config = apiConfig(env)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: config.authorization,
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    })

    if (!response.ok) throw new Error('Mail API request failed')
  } catch {
    throw new Error('Failed to send email')
  } finally {
    clearTimeout(timeout)
  }
}

export function createRecoveryMailer(env: Environment = process.env): RecoveryMailer {
  if (!emailEnabled(env)) {
    return {
      async sendCode() {},
      async sendChangedNotice() {},
    }
  }

  return {
    async sendCode({ to, code, expiresInMinutes }) {
      const safeCode = escapeHtml(code)
      await postMail(env, {
        to,
        subject: 'Your Kin Keepers recovery code',
        body: `Your Kin Keepers recovery code is ${code}. It expires in ${expiresInMinutes} minutes.`,
        html: `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#EEF2F7;color:#0C2348;padding:32px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:18px;padding:32px"><strong style="color:#0E9F9A">KIN-KEEPERS</strong><h1>Reset your password</h1><p>Enter this one-time recovery code in Family Circle:</p><div style="font-family:monospace;font-size:30px;letter-spacing:7px;font-weight:700;background:#E9FBF6;padding:18px;border-radius:12px;text-align:center">${safeCode}</div><p>It expires in ${Number(expiresInMinutes)} minutes and can be used only once.</p><p style="color:#667085">If you did not request this reset, ignore this email. Your password has not changed.</p></div></body></html>`,
      })
    },

    async sendChangedNotice({ to }) {
      await postMail(env, {
        to,
        subject: 'Kin Keepers password changed',
        body: 'Your Kin Keepers password was changed and existing sessions were invalidated.',
        html: '<!doctype html><html><body style="font-family:Arial,sans-serif;background:#EEF2F7;color:#0C2348;padding:32px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:18px;padding:32px"><strong style="color:#0E9F9A">KIN-KEEPERS</strong><h1>Your password was changed</h1><p>Your Family Circle password was reset successfully. Existing sessions were invalidated; please sign in again.</p><p style="color:#667085">If you did not make this change, contact your Kin-Keepers administrator immediately.</p></div></body></html>',
      })
    },
  }
}
