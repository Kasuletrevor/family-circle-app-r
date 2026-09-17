import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRecoveryMailer } from './RecoveryMailer'

describe('RecoveryMailer HTTP failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps non-success API responses to a safe mail error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream failure', { status: 503 })))
    const mailer = createRecoveryMailer({ SEND_EMAILS: 'true', MAIL_API_USER: 'unit-user', MAIL_API_PASSWORD: 'unit-password' })
    await expect(mailer.sendChangedNotice({ to: 'person@example.com' })).rejects.toThrow('Failed to send email')
  })

  it('maps network failures to the same safe mail error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused') }))
    const mailer = createRecoveryMailer({ SEND_EMAILS: 'true', MAIL_API_USER: 'unit-user', MAIL_API_PASSWORD: 'unit-password' })
    await expect(mailer.sendChangedNotice({ to: 'person@example.com' })).rejects.toThrow('Failed to send email')
  })

  it('adds an abort timeout and hides timeout details', async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) {
        reject(new Error('missing abort signal'))
        return
      }
      signal.addEventListener('abort', () => reject(new Error('timed out')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const mailer = createRecoveryMailer({
      SEND_EMAILS: 'true',
      MAIL_API_USER: 'unit-user',
      MAIL_API_PASSWORD: 'unit-password',
      MAIL_API_TIMEOUT_MS: '5',
    })

    await expect(mailer.sendChangedNotice({ to: 'person@example.com' })).rejects.toThrow('Failed to send email')
    const signal = fetchMock.mock.calls[0]![1]?.signal
    expect(signal).toBeDefined()
    expect(signal?.aborted).toBe(true)
  })

  it('keeps email disabled unless SEND_EMAILS is explicitly true', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const mailer = createRecoveryMailer({ SEND_EMAILS: 'false', MAIL_API_USER: 'unit-user', MAIL_API_PASSWORD: 'unit-password' })
    await mailer.sendCode({ to: 'person@example.com', code: '12345678', expiresInMinutes: 10 })
    await mailer.sendChangedNotice({ to: 'person@example.com' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
