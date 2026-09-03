import type { DatabaseSync } from 'node:sqlite'
import type { AuthUser, RegisterInput } from '../../shared/desktopApi'
import { withTransaction } from '../database/database'
import { hashPassword, verifyPasswordHash } from './passwordCrypto'
import { assertValidPassword, normalizeEmail } from './passwordPolicy'

interface UserRow {
  id: number
  email: string
  password_hash: string
  name: string | null
  server_user_id: string | null
  active_circle_id: string | null
  session_version: number
  must_change_password: number
  onboarding_completed: number
  account_origin: 'registered' | 'invited' | 'existing'
  invitation_group_id: string | null
  invitation_group_name: string | null
  invitation_role: string | null
}

export interface UserRecord {
  user: AuthUser
  passwordHash: string
  serverUserId: string | null
  activeCircleId: string | null
  sessionVersion: number
  invitation: null | { groupId: string; groupName: string; role: string }
}

export interface CreateInvitedUserInput {
  name: string
  email: string
  password: string
  serverUserId: string
  invitation: { groupId: string; groupName: string; role: string }
}

function shapeUser(row: UserRow): AuthUser {
  return {
    id: Number(row.id),
    email: String(row.email),
    name: row.name ?? null,
    accountOrigin: row.account_origin,
    mustChangePassword: Number(row.must_change_password) === 1,
    onboardingCompleted: Number(row.onboarding_completed) === 1,
  }
}

function shapeRecord(row: UserRow | undefined): UserRecord | null {
  if (!row) return null
  return {
    user: shapeUser(row),
    passwordHash: String(row.password_hash),
    serverUserId: row.server_user_id ?? null,
    activeCircleId: row.active_circle_id ?? null,
    sessionVersion: Number(row.session_version || 0),
    invitation: row.invitation_group_id
      ? {
          groupId: row.invitation_group_id,
          groupName: row.invitation_group_name || 'Family Circle',
          role: row.invitation_role || 'Family member',
        }
      : null,
  }
}

export class UserRepository {
  constructor(private readonly db: DatabaseSync) {}

  async getRecordByEmail(email: string): Promise<UserRecord | null> {
    const row = this.db.prepare(`
      SELECT id, email, password_hash, name, server_user_id, active_circle_id, session_version,
             must_change_password, onboarding_completed, account_origin,
             invitation_group_id, invitation_group_name, invitation_role
        FROM users
       WHERE LOWER(email) = LOWER(?)
    `).get(normalizeEmail(email)) as UserRow | undefined
    return shapeRecord(row)
  }

  async getRecordById(id: number): Promise<UserRecord | null> {
    const row = this.db.prepare(`
      SELECT id, email, password_hash, name, server_user_id, active_circle_id, session_version,
             must_change_password, onboarding_completed, account_origin,
             invitation_group_id, invitation_group_name, invitation_role
        FROM users
       WHERE id = ?
    `).get(id) as UserRow | undefined
    return shapeRecord(row)
  }

  async createRegisteredUser(input: RegisterInput): Promise<AuthUser> {
    const email = normalizeEmail(input.email)
    const name = String(input.name ?? '').trim()
    if (!email) throw new Error('Email is required')
    if (name.length < 2) throw new Error('Enter the name you want your family to see')
    assertValidPassword(input.password)
    const passwordHash = await hashPassword(input.password)
    const now = Date.now()

    let id: number
    try {
      id = withTransaction(this.db, () => {
        const result = this.db.prepare(`
          INSERT INTO users (
            email, password_hash, name, session_version, must_change_password,
            onboarding_completed, account_origin, created_at, updated_at
          ) VALUES (?, ?, ?, 0, 0, 0, 'registered', ?, ?)
        `).run(email, passwordHash, name, now, now)
        return Number(result.lastInsertRowid)
      })
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) throw new Error('Email already registered')
      throw error
    }

    const record = await this.getRecordById(id)
    if (!record) throw new Error('Failed to read the created account')
    return record.user
  }

  async createInvitedUser(input: CreateInvitedUserInput): Promise<AuthUser> {
    const email = normalizeEmail(input.email)
    const name = String(input.name ?? '').trim() || email.split('@')[0]
    if (!email) throw new Error('Email is required')
    assertValidPassword(input.password)
    const passwordHash = await hashPassword(input.password)
    const now = Date.now()

    let id: number
    try {
      id = withTransaction(this.db, () => {
        const result = this.db.prepare(`
          INSERT INTO users (
            email, password_hash, name, server_user_id, session_version,
            must_change_password, onboarding_completed, account_origin,
            invitation_group_id, invitation_group_name, invitation_role,
            claimed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 0, 1, 0, 'invited', ?, ?, ?, ?, ?, ?)
        `).run(
          email,
          passwordHash,
          name,
          input.serverUserId,
          input.invitation.groupId,
          input.invitation.groupName,
          input.invitation.role,
          now,
          now,
          now,
        )
        return Number(result.lastInsertRowid)
      })
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) throw new Error('Email already registered')
      throw error
    }

    const record = await this.getRecordById(id)
    if (!record) throw new Error('Failed to read the invited account')
    return record.user
  }

  async setServerUserId(userId: number, serverUserId: string): Promise<void> {
    const value = String(serverUserId).trim()
    if (!value) throw new Error('Shared user ID is required')
    const result = this.db.prepare(
      'UPDATE users SET server_user_id = ?, updated_at = ? WHERE id = ?',
    ).run(value, Date.now(), userId)
    if (Number(result.changes) !== 1) throw new Error('User not found')
  }

  async setActiveCircleId(userId: number, circleId: string | null): Promise<void> {
    const value = circleId == null ? null : String(circleId).trim() || null
    const result = this.db.prepare(
      'UPDATE users SET active_circle_id = ?, updated_at = ? WHERE id = ?',
    ).run(value, Date.now(), userId)
    if (Number(result.changes) !== 1) throw new Error('User not found')
  }

  async verifyPassword(userId: number, password: string): Promise<boolean> {
    const record = await this.getRecordById(userId)
    if (!record?.passwordHash) return false
    return verifyPasswordHash(password, record.passwordHash)
  }

  async replacePassword(
    userId: number,
    password: string,
    options: { clearMustChangePassword?: boolean } = {},
  ): Promise<AuthUser> {
    assertValidPassword(password)
    const passwordHash = await hashPassword(password)
    const now = Date.now()

    withTransaction(this.db, () => {
      const result = options.clearMustChangePassword
        ? this.db.prepare(`
            UPDATE users
               SET password_hash = ?, must_change_password = 0,
                   session_version = COALESCE(session_version, 0) + 1, updated_at = ?
             WHERE id = ?
          `).run(passwordHash, now, userId)
        : this.db.prepare(`
            UPDATE users
               SET password_hash = ?, session_version = COALESCE(session_version, 0) + 1, updated_at = ?
             WHERE id = ?
          `).run(passwordHash, now, userId)
      if (Number(result.changes) !== 1) throw new Error('User not found')
    })

    const record = await this.getRecordById(userId)
    if (!record) throw new Error('User not found')
    return record.user
  }

  async updateProfile(userId: number, name: string): Promise<AuthUser> {
    const cleanName = String(name ?? '').trim()
    if (cleanName.length < 2) throw new Error('Enter the name you want your family to see')
    const result = this.db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(cleanName, Date.now(), userId)
    if (Number(result.changes) !== 1) throw new Error('User not found')
    const record = await this.getRecordById(userId)
    if (!record) throw new Error('User not found')
    return record.user
  }

  async markOnboardingComplete(userId: number): Promise<AuthUser> {
    const result = this.db.prepare('UPDATE users SET onboarding_completed = 1, updated_at = ? WHERE id = ?').run(Date.now(), userId)
    if (Number(result.changes) !== 1) throw new Error('User not found')
    const record = await this.getRecordById(userId)
    if (!record) throw new Error('User not found')
    return record.user
  }

  async getSessionVersion(userId: number): Promise<number> {
    const row = this.db.prepare('SELECT session_version FROM users WHERE id = ?').get(userId) as { session_version: number } | undefined
    if (!row) throw new Error('User not found')
    return Number(row.session_version || 0)
  }
}
