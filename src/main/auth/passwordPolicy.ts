export function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase()
}

export function assertValidPassword(password: string): void {
  const length = String(password ?? '').length
  if (length < 12 || length > 72) {
    throw new Error('Password must be between 12 and 72 characters')
  }
}
