import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRecoveryMailer } from './RecoveryMailer'

describe('RecoveryMailer HTTP failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps non-success API responses to a safe mail error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream failure', { status: 503 })))

    const mailer = createRecoveryMailer({
      SEND_EMAILS: 'true',
      MAIL_API_USER: 'unit-user',
      MAIL_API_PASSWORD: 'unit-secret',
    })

    await expect(mailer.sendChangedNotice({ to: 'person@example.com' }))
      .rejects.toThrow('Failed to send email')
  })
})
