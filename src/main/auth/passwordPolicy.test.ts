import { describe, expect, it } from 'vitest'
import { assertValidPassword, normalizeEmail } from './passwordPolicy'

describe('passwordPolicy', () => {
  it('normalizes email', () => {
    expect(normalizeEmail(' A@Example.COM ')).toBe('a@example.com')
  })

  it('accepts passwords from 12 through 72 characters', () => {
    expect(() => assertValidPassword('a'.repeat(12))).not.toThrow()
    expect(() => assertValidPassword('a'.repeat(72))).not.toThrow()
  })

  it('rejects passwords outside 12 through 72 characters', () => {
    expect(() => assertValidPassword('a'.repeat(11))).toThrow('12 and 72')
    expect(() => assertValidPassword('a'.repeat(73))).toThrow('12 and 72')
  })
})
