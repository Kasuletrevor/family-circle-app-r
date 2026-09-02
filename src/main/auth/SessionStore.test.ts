import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import { SessionStore, type ProtectedCrypto, type SessionFile } from './SessionStore'

const user: AuthUser = {
  id: 7,
  email: 'trevor@example.com',
  name: 'Trevor',
  accountOrigin: 'existing',
  mustChangePassword: false,
  onboardingCompleted: true,
}

function createHarness(options: {
  now?: number
  userExists?: boolean
  sessionVersion?: number
  cryptoAvailable?: boolean
} = {}) {
  let stored: Buffer | null = null
  const remove = vi.fn(async () => { stored = null })
  const file: SessionFile = {
    read: async () => stored,
    write: async (value) => { stored = Buffer.from(value) },
    remove,
  }
  const crypto: ProtectedCrypto = {
    isAvailable: () => options.cryptoAvailable ?? true,
    encrypt: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decrypt: (value) => {
      const text = value.toString('utf8')
      if (!text.startsWith('encrypted:')) throw new Error('corrupt')
      return text.slice('encrypted:'.length)
    },
  }
  const repository = {
    getRecordById: vi.fn(async (id: number) => options.userExists === false || id !== user.id
      ? null
      : { user, passwordHash: 'hidden', serverUserId: null, sessionVersion: options.sessionVersion ?? 3, invitation: null }),
    getSessionVersion: vi.fn(async () => options.sessionVersion ?? 3),
  }
  let now = options.now ?? 1_000_000
  const store = new SessionStore(repository, crypto, file, () => now)
  return {
    store,
    file,
    remove,
    getStored: () => stored,
    setStored: (value: Buffer | null) => { stored = value },
    setNow: (value: number) => { now = value },
  }
}

describe('SessionStore', () => {
  it('saves and restores a protected 30-day session without exposing the password hash', async () => {
    const harness = createHarness()
    await harness.store.save(user.id)

    expect(harness.getStored()?.toString('utf8')).toContain('encrypted:')
    expect(harness.getStored()?.toString('utf8')).not.toContain('password')
    await expect(harness.store.restore()).resolves.toEqual(user)
  })

  it('expires sessions after 30 days and removes them', async () => {
    const start = 1_000_000
    const harness = createHarness({ now: start })
    await harness.store.save(user.id)
    harness.setNow(start + 30 * 24 * 60 * 60 * 1000 + 1)

    await expect(harness.store.restore()).resolves.toBeNull()
    expect(harness.remove).toHaveBeenCalled()
  })

  it('removes corrupt protected payloads', async () => {
    const harness = createHarness()
    harness.setStored(Buffer.from('not-encrypted'))

    await expect(harness.store.restore()).resolves.toBeNull()
    expect(harness.remove).toHaveBeenCalled()
  })

  it('removes a session when the local user is missing', async () => {
    const harness = createHarness({ userExists: false })
    await harness.store.save(user.id)

    await expect(harness.store.restore()).resolves.toBeNull()
    expect(harness.remove).toHaveBeenCalled()
  })

  it('removes a session when sessionVersion no longer matches', async () => {
    const harness = createHarness({ sessionVersion: 3 })
    await harness.store.save(user.id)
    const encrypted = harness.getStored()
    const payload = JSON.parse(encrypted!.toString('utf8').slice('encrypted:'.length))
    payload.sessionVersion = 2
    harness.setStored(Buffer.from(`encrypted:${JSON.stringify(payload)}`))

    await expect(harness.store.restore()).resolves.toBeNull()
    expect(harness.remove).toHaveBeenCalled()
  })

  it('clears the protected file and refuses plaintext fallback when encryption is unavailable', async () => {
    const unavailable = createHarness({ cryptoAvailable: false })
    await expect(unavailable.store.save(user.id)).rejects.toThrow('Protected session storage is unavailable')
    expect(unavailable.getStored()).toBeNull()

    const harness = createHarness()
    await harness.store.save(user.id)
    await harness.store.clear()
    expect(harness.getStored()).toBeNull()
  })
})
