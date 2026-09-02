import nodemailer from 'nodemailer'

export interface RecoveryMailer {
  sendCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void>
  sendChangedNotice(input: { to: string }): Promise<void>
}

type Environment = NodeJS.ProcessEnv

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

function createTransport(env: Environment) {
  const host = envValue(env, 'SMTP_HOST', 'MAIL_HOST')
  const port = Number(envValue(env, 'SMTP_PORT', 'EMAIL_PORT') || 587)
  const user = envValue(env, 'MAIL_USER', 'EMAIL_USER')
  const pass = envValue(env, 'EMAIL_PASS', 'MAIL_PASS')
  if (!host || !user || !pass) throw new Error('SMTP configuration is incomplete')
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('SMTP port is invalid')

  const secureSetting = envValue(env, 'SMTP_SECURE', 'EMAIL_SECURE').toLowerCase()
  const secure = secureSetting ? secureSetting === 'true' : port === 465
  const timeout = Number(envValue(env, 'SMTP_TIMEOUT_MS', 'EMAIL_TIMEOUT_MS') || 45_000)
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 45_000

  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass },
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  })
}

function sender(env: Environment): string {
  return env.FROM_EMAIL || `Kin Keepers <${envValue(env, 'MAIL_USER', 'EMAIL_USER')}>`
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
      const transport = createTransport(env)
      try {
        const safeCode = escapeHtml(code)
        await transport.sendMail({
          from: sender(env),
          to,
          subject: 'Your Kin Keepers recovery code',
          text: `Your Kin Keepers recovery code is ${code}. It expires in ${expiresInMinutes} minutes.`,
          html: `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#EEF2F7;color:#0C2348;padding:32px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:18px;padding:32px"><strong style="color:#0E9F9A">KIN-KEEPERS</strong><h1>Reset your password</h1><p>Enter this one-time recovery code in Family Circle:</p><div style="font-family:monospace;font-size:30px;letter-spacing:7px;font-weight:700;background:#E9FBF6;padding:18px;border-radius:12px;text-align:center">${safeCode}</div><p>It expires in ${Number(expiresInMinutes)} minutes and can be used only once.</p><p style="color:#667085">If you did not request this reset, ignore this email. Your password has not changed.</p></div></body></html>`,
        })
      } finally {
        transport.close()
      }
    },

    async sendChangedNotice({ to }) {
      const transport = createTransport(env)
      try {
        await transport.sendMail({
          from: sender(env),
          to,
          subject: 'Kin Keepers password changed',
          text: 'Your Kin Keepers password was changed and existing sessions were invalidated.',
          html: '<!doctype html><html><body style="font-family:Arial,sans-serif;background:#EEF2F7;color:#0C2348;padding:32px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:18px;padding:32px"><strong style="color:#0E9F9A">KIN-KEEPERS</strong><h1>Your password was changed</h1><p>Your Family Circle password was reset successfully. Existing sessions were invalidated; please sign in again.</p><p style="color:#667085">If you did not make this change, contact your Kin-Keepers administrator immediately.</p></div></body></html>',
        })
      } finally {
        transport.close()
      }
    },
  }
}
