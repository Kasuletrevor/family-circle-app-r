import { describe, expect, it } from 'vitest'
import { CONNECTION_MESSAGE, MAIL_MESSAGE, userFacingError } from './userFacingError'

const FALLBACK = 'Could not check this email. Please try again.'

describe('userFacingError', () => {
  it('removes the desktop bridge prefix and keeps messages written for people', () => {
    expect(userFacingError(new Error("Error invoking remote method 'auth:sign-in': Error: Incorrect password."), FALLBACK))
      .toBe('Incorrect password.')
    expect(userFacingError(new Error("Error invoking remote method 'auth:register': Error: Email already registered"), FALLBACK))
      .toBe('Email already registered')
  })

  it('explains server and network failures in plain words', () => {
    for (const raw of [
      "Error invoking remote method 'auth:check-invitation': Error: Circle service authentication failed",
      "Error invoking remote method 'auth:sign-in': Error: Circle service request timed out",
      "Error invoking remote method 'auth:sign-in': TypeError: fetch failed",
      'getaddrinfo ENOTFOUND familycircle.o2gventures.com',
    ]) {
      expect(userFacingError(new Error(raw), FALLBACK)).toBe(CONNECTION_MESSAGE)
    }
    expect(userFacingError(new Error("Error invoking remote method 'auth:request-password-reset': Error: Mail API request failed"), FALLBACK))
      .toBe(MAIL_MESSAGE)
  })

  it('never shows paths, stack traces or empty messages', () => {
    expect(userFacingError(new Error("Error invoking remote method 'settings:create-backup': Error: EPERM: operation not permitted, open 'C:\\Users\\x\\family.db'"), FALLBACK)).toBe(FALLBACK)
    expect(userFacingError(new Error('Cannot read properties of undefined (reading "id")'), FALLBACK)).toBe(FALLBACK)
    expect(userFacingError(new Error("Error invoking remote method 'auth:sign-in': Error: "), FALLBACK)).toBe(FALLBACK)
    expect(userFacingError({ weird: true }, FALLBACK)).toBe(FALLBACK)
  })
})
