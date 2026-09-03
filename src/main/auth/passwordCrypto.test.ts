import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPasswordHash } from './passwordCrypto'

describe('passwordCrypto', () => {
  it('creates a bcrypt hash and verifies the original password', async () => {
    const password = 'correct horse battery staple'
    const passwordHash = await hashPassword(password)

    expect(passwordHash).toMatch(/^\$2[aby]\$/)
    await expect(verifyPasswordHash(password, passwordHash)).resolves.toBe(true)
    await expect(verifyPasswordHash('wrong password', passwordHash)).resolves.toBe(false)
  })
})
