import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../database/migrations'
import { UserRepository } from './UserRepository'
import type { RecoveryMailer } from './RecoveryMailer'
import { PasswordRecoveryService } from './PasswordRecoveryService'

const databases: DatabaseSync[] = []

async function createHarness() {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  runMigrations(db)
  const users = new UserRepository(db)
  await users.createRegisteredUser({ name: 'Trevor', email: 'trevor@example.com', password: 'correct horse battery staple' })
  let now = 1_000_000
  let nextCode = 12345678
  const mailer: RecoveryMailer = {
    sendCode: vi.fn(async () => undefined),
    sendChangedNotice: vi.fn(async () => undefined),
  }
  const service = new PasswordRecoveryService(db, users, mailer, {
    now: () => now,
    generateCode: () => String(nextCode++).padStart(8, '0'),
  })
  return { db, users, mailer, service, setNow: (value: number) => { now = value } }
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

describe('PasswordRecoveryService', () => {
  it('returns the same neutral response for known and unknown accounts', async () => {
    const { service, mailer } = await createHarness()
    const known = await service.request('trevor@example.com')
    const unknown = await service.request('nobody@example.com')

    expect(known).toEqual(unknown)
    expect(known.message).toBe('If an account exists for that email, a recovery code has been sent.')
    expect(mailer.sendCode).toHaveBeenCalledTimes(1)
  })

  it('stores only a SHA-256 hash of the eight-digit recovery code with a 10-minute expiry', async () => {
    const { db, service } = await createHarness()
    await service.request('trevor@example.com')
    const row = db.prepare('SELECT token_hash, expires_at, created_at FROM password_reset_tokens').get() as {
      token_hash: string; expires_at: number; created_at: number
    }

    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(row.token_hash).not.toContain('12345678')
    expect(row.expires_at - row.created_at).toBe(10 * 60 * 1000)
  })

  it('enforces one request per minute and at most three issued requests per hour', async () => {
    const { db, service, setNow } = await createHarness()
    await service.request('trevor@example.com')
    setNow(1_030_000)
    await service.request('trevor@example.com')
    expect(db.prepare('SELECT COUNT(*) AS count FROM password_reset_tokens').get()).toMatchObject({ count: 1 })

    setNow(1_061_000)
    await service.request('trevor@example.com')
    setNow(1_122_000)
    await service.request('trevor@example.com')
    setNow(1_183_000)
    await service.request('trevor@example.com')
    expect(db.prepare('SELECT COUNT(*) AS count FROM password_reset_tokens').get()).toMatchObject({ count: 3 })
  })

  it('invalidates a code after five incorrect attempts', async () => {
    const { db, service } = await createHarness()
    await service.request('trevor@example.com')

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(service.reset({
        email: 'trevor@example.com',
        code: '00000000',
        newPassword: 'a new secure password 123',
      })).rejects.toThrow(attempt === 5 ? 'Too many incorrect attempts' : 'Recovery code is invalid')
    }

    expect(db.prepare('SELECT attempts, used_at FROM password_reset_tokens').get()).toMatchObject({ attempts: 5 })
    expect((db.prepare('SELECT used_at FROM password_reset_tokens').get() as { used_at: number | null }).used_at).not.toBeNull()
  })

  it('rejects expired codes and old-password reuse', async () => {
    const expired = await createHarness()
    await expired.service.request('trevor@example.com')
    expired.setNow(1_000_000 + 10 * 60 * 1000 + 1)
    await expect(expired.service.reset({
      email: 'trevor@example.com',
      code: '12345678',
      newPassword: 'a new secure password 123',
    })).rejects.toThrow('expired')

    const reuse = await createHarness()
    await reuse.service.request('trevor@example.com')
    await expect(reuse.service.reset({
      email: 'trevor@example.com',
      code: '12345678',
      newPassword: 'correct horse battery staple',
    })).rejects.toThrow('different from your previous password')
  })

  it('consumes the code once, replaces the password and invalidates older sessions', async () => {
    const { service, users, mailer } = await createHarness()
    await service.request('trevor@example.com')
    const before = await users.getRecordByEmail('trevor@example.com')

    await expect(service.reset({
      email: 'trevor@example.com',
      code: '12345678',
      newPassword: 'a new secure password 123',
    })).resolves.toEqual({ success: true })

    const after = await users.getRecordByEmail('trevor@example.com')
    expect(after!.sessionVersion).toBe(before!.sessionVersion + 1)
    await expect(users.verifyPassword(after!.user.id, 'a new secure password 123')).resolves.toBe(true)
    await expect(users.verifyPassword(after!.user.id, 'correct horse battery staple')).resolves.toBe(false)
    expect(mailer.sendChangedNotice).toHaveBeenCalledWith({ to: 'trevor@example.com' })

    await expect(service.reset({
      email: 'trevor@example.com',
      code: '12345678',
      newPassword: 'another secure password 123',
    })).rejects.toThrow('invalid or has already been used')
  })
})
