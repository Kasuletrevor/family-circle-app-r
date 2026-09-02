import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ResetPasswordInput } from '../../shared/desktopApi'
import { withTransaction } from '../database/database'
import { hashPassword, verifyPasswordHash } from './passwordCrypto'
import { assertValidPassword, normalizeEmail } from './passwordPolicy'
import type { RecoveryMailer } from './RecoveryMailer'
import type { UserRepository } from './UserRepository'

const RESET_TTL_MS = 10 * 60 * 1000
const RESET_WINDOW_MS = 60 * 60 * 1000
const RESET_REQUEST_LIMIT = 3
const RESET_ATTEMPT_LIMIT = 5
const RESET_MIN_INTERVAL_MS = 60 * 1000
const NEUTRAL_MESSAGE = 'If an account exists for that email, a recovery code has been sent.'

interface RecoveryOptions {
  now?: () => number
  generateCode?: () => string
}

interface RecoveryRow {
  id: number
  user_id: number
  token_hash: string
  expires_at: number
  used_at: number | null
  attempts: number
  password_hash: string
  email: string
}

function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function recoveryCodesMatch(suppliedCode: string, expectedHash: string): boolean {
  const supplied = Buffer.from(hashRecoveryCode(suppliedCode), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export class PasswordRecoveryService {
  private readonly now: () => number
  private readonly generateCode: () => string

  constructor(
    private readonly db: DatabaseSync,
    private readonly users: UserRepository,
    private readonly mailer: RecoveryMailer,
    options: RecoveryOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.generateCode = options.generateCode ?? (() => String(randomInt(0, 100_000_000)).padStart(8, '0'))
  }

  async request(emailInput: string): Promise<{ success: true; message: string; expiresInMinutes: number }> {
    const email = normalizeEmail(emailInput)
    const neutral = { success: true as const, message: NEUTRAL_MESSAGE, expiresInMinutes: 10 }
    if (!email) return neutral

    const record = await this.users.getRecordByEmail(email)
    if (!record) return neutral

    const now = this.now()
    const recent = this.db.prepare(`
      SELECT COUNT(*) AS total, MAX(created_at) AS latest
        FROM password_reset_tokens
       WHERE user_id = ? AND created_at >= ?
    `).get(record.user.id, now - RESET_WINDOW_MS) as { total: number; latest: number | null }

    const total = Number(recent?.total ?? 0)
    const latest = recent?.latest == null ? null : Number(recent.latest)
    if (total >= RESET_REQUEST_LIMIT || (latest !== null && now - latest < RESET_MIN_INTERVAL_MS)) {
      return neutral
    }

    const code = this.generateCode()
    const tokenHash = hashRecoveryCode(code)
    const expiresAt = now + RESET_TTL_MS

    withTransaction(this.db, () => {
      this.db.prepare(`
        UPDATE password_reset_tokens
           SET used_at = ?
         WHERE user_id = ? AND used_at IS NULL
      `).run(now, record.user.id)

      this.db.prepare(`
        INSERT INTO password_reset_tokens
          (user_id, token_hash, expires_at, used_at, attempts, created_at)
        VALUES (?, ?, ?, NULL, 0, ?)
      `).run(record.user.id, tokenHash, expiresAt, now)
    })

    try {
      await this.mailer.sendCode({ to: record.user.email, code, expiresInMinutes: 10 })
    } catch (error) {
      console.warn('[auth] Password recovery email failed:', error instanceof Error ? error.message : String(error))
    }

    return neutral
  }

  async reset(input: ResetPasswordInput): Promise<{ success: true }> {
    const email = normalizeEmail(input.email)
    const code = String(input.code ?? '').trim()
    if (!email || !code) throw new Error('Email and recovery code are required')
    assertValidPassword(input.newPassword)

    const row = this.db.prepare(`
      SELECT prt.id, prt.user_id, prt.token_hash, prt.expires_at, prt.used_at,
             prt.attempts, users.password_hash, users.email
        FROM password_reset_tokens prt
        JOIN users ON users.id = prt.user_id
       WHERE LOWER(users.email) = LOWER(?) AND prt.used_at IS NULL
       ORDER BY prt.created_at DESC
       LIMIT 1
    `).get(email) as RecoveryRow | undefined

    if (!row) throw new Error('Recovery code is invalid or has already been used')

    if (!recoveryCodesMatch(code, row.token_hash)) {
      const attempts = Number(row.attempts || 0) + 1
      const now = this.now()
      this.db.prepare(`
        UPDATE password_reset_tokens
           SET attempts = ?,
               used_at = CASE WHEN ? >= ? THEN ? ELSE used_at END
         WHERE id = ?
      `).run(attempts, attempts, RESET_ATTEMPT_LIMIT, now, row.id)

      if (attempts >= RESET_ATTEMPT_LIMIT) {
        throw new Error('Too many incorrect attempts. Request a new recovery code.')
      }
      throw new Error('Recovery code is invalid or has already been used')
    }

    const now = this.now()
    if (Number(row.expires_at) < now) {
      this.db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(now, row.id)
      throw new Error('Recovery code has expired. Please request a new one.')
    }

    if (await verifyPasswordHash(input.newPassword, row.password_hash)) {
      throw new Error('New password must be different from your previous password')
    }

    const passwordHash = await hashPassword(input.newPassword)

    withTransaction(this.db, () => {
      const consumed = this.db.prepare(`
        UPDATE password_reset_tokens
           SET used_at = ?
         WHERE id = ? AND used_at IS NULL AND attempts < ?
      `).run(now, row.id, RESET_ATTEMPT_LIMIT)
      if (Number(consumed.changes) !== 1) {
        throw new Error('Recovery code is invalid or has already been used')
      }

      const changed = this.db.prepare(`
        UPDATE users
           SET password_hash = ?,
               must_change_password = 0,
               session_version = COALESCE(session_version, 0) + 1,
               updated_at = ?
         WHERE id = ?
      `).run(passwordHash, now, row.user_id)
      if (Number(changed.changes) !== 1) throw new Error('User not found')

      this.db.prepare(`
        UPDATE password_reset_tokens
           SET used_at = ?
         WHERE user_id = ? AND used_at IS NULL
      `).run(now, row.user_id)
    })

    try {
      await this.mailer.sendChangedNotice({ to: row.email })
    } catch (error) {
      console.warn('[auth] Password-change notice failed:', error instanceof Error ? error.message : String(error))
    }

    return { success: true }
  }
}
