import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRecoveryMailer } from './RecoveryMailer'

describe('RecoveryMailer HTTP transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts recovery-code mail to the configured API with JSON and Basic auth', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const user = 'test-api-user'
    const password = 'unit-test-password'
    const mailer = createRecoveryMailer({
      SEND_EMAILS: 'true',
      MAIL_API_URL: 'https://example.test/send-mail/',
      MAIL_API_USER: user,
      MAIL_API_PASSWORD: password,
    })

    await mailer.sendCode({
      to: 'person@example.com',
      code: '12345678',
      expiresInMinutes: 10,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://example.test/send-mail/')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    })

    const payload = JSON.parse(String(init?.body)) as Record<string, string>
    expect(payload.to).toBe('person@example.com')
    expect(payload.subject).toBe('Your Kin Keepers recovery code')
    expect(payload.body).toContain('12345678')
    expect(payload.html).toContain('12345678')
  })

  it('posts the password-changed notice through the same mail API', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const mailer = createRecoveryMailer({
      SEND_EMAILS: 'true',
      MAIL_API_URL: 'https://example.test/send-mail/',
      MAIL_API_USER: 'test-api-user',
      MAIL_API_PASSWORD: 'unit-test-password',
    })

    await mailer.sendChangedNotice({ to: 'person@example.com' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, string>
    expect(payload).toMatchObject({
      to: 'person@example.com',
      subject: 'Kin Keepers password changed',
    })
    expect(payload.body).toContain('existing sessions were invalidated')
    expect(payload.html).toContain('Your password was changed')
  })
})
