import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InvitationCheckResult, ResetPasswordInput } from '../../shared/desktopApi'
import type { ClaimedInvitation } from '../circle/LegacyCircleAuthAdapter'
import { runMigrations } from '../database/migrations'
import { AuthService, type CircleAuthPort, type RecoveryPort } from './AuthService'
import { SessionStore, type ProtectedCrypto, type SessionFile } from './SessionStore'
import { UserRepository } from './UserRepository'

const databases: DatabaseSync[] = []

function memorySession(users: UserRepository): SessionStore {
  let stored: Buffer | null = null
  const crypto: ProtectedCrypto = {
    isAvailable: () => true,
    encrypt: (value) => Buffer.from(`protected:${value}`),
    decrypt: (value) => value.toString().slice('protected:'.length),
  }
  const file: SessionFile = {
    read: async () => stored,
    write: async (value) => { stored = Buffer.from(value) },
    remove: async () => { stored = null },
  }
  return new SessionStore(users, crypto, file, () => 1_000_000)
}

function createHarness(overrides: {
  invitation?: InvitationCheckResult
  claim?: ClaimedInvitation | Error
  memberships?: Array<{ id: string; name: string; role: string }>
} = {}) {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  runMigrations(db)
  const users = new UserRepository(db)
  const sessions = memorySession(users)
  const invitation = overrides.invitation ?? { hasPendingInvite: false, groupName: null, role: null }
  const claim: ClaimedInvitation = {
    email: 'invite@example.com',
    name: 'Invited Person',
    serverUserId: '42',
    verifiedTemporaryPassword: 'temporary password 123',
    invitation: { groupId: 'g-1', groupName: 'Kasule Family', role: 'Family member' },
  }
  const circle: CircleAuthPort = {
    checkInvitation: vi.fn(async () => invitation),
    claimInvitation: vi.fn(async () => {
      if (overrides.claim instanceof Error) throw overrides.claim
      return overrides.claim ?? claim
    }),
    getMemberships: vi.fn(async () => overrides.memberships ?? [{ id: 'g-1', name: 'Kasule Family', role: 'Family member' }]),
  }
  const recovery: RecoveryPort = {
    request: vi.fn(async () => ({
      success: true as const,
      message: 'If an account exists for that email, a recovery code has been sent.',
      expiresInMinutes: 10,
    })),
    reset: vi.fn(async (_input: ResetPasswordInput) => ({ success: true as const })),
  }
  const service = new AuthService(users, sessions, recovery, circle)
  return { db, users, sessions, recovery, circle, service }
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

describe('AuthService', () => {
  it('restores unauthenticated, onboarding, and authenticated session states', async () => {
    const empty = createHarness()
    await expect(empty.service.restore()).resolves.toEqual({ status: 'unauthenticated' })

    const onboarding = createHarness()
    const owner = await onboarding.users.createRegisteredUser({
      name: 'Trevor', email: 'owner@example.com', password: 'correct horse battery staple',
    })
    await onboarding.sessions.save(owner.id)
    await expect(onboarding.service.restore()).resolves.toMatchObject({ status: 'onboarding', user: { email: 'owner@example.com' } })

    const authenticated = createHarness()
    const existing = await authenticated.users.createRegisteredUser({
      name: 'Existing', email: 'existing@example.com', password: 'correct horse battery staple',
    })
    await authenticated.users.markOnboardingComplete(existing.id)
    await authenticated.sessions.save(existing.id)
    await expect(authenticated.service.restore()).resolves.toMatchObject({ status: 'authenticated', user: { email: 'existing@example.com' } })
  })

  it('signs in an existing local user and never falls back to remote invitation claim for a wrong local password', async () => {
    const { users, service, circle } = createHarness()
    await users.createRegisteredUser({
      name: 'Trevor', email: 'trevor@example.com', password: 'correct horse battery staple',
    })

    await expect(service.signIn({ email: ' TREVOR@example.com ', password: 'correct horse battery staple' }))
      .resolves.toMatchObject({ status: 'onboarding', user: { email: 'trevor@example.com' } })
    expect(circle.claimInvitation).not.toHaveBeenCalled()

    await expect(service.signIn({ email: 'trevor@example.com', password: 'wrong password' })).rejects.toThrow('Incorrect password')
    expect(circle.claimInvitation).not.toHaveBeenCalled()
  })

  it('creates a first-time invited local account only after the remote claim succeeds', async () => {
    const { users, service } = createHarness()
    await expect(service.signIn({ email: 'invite@example.com', password: 'temporary password 123' }))
      .resolves.toMatchObject({
        status: 'onboarding',
        user: { email: 'invite@example.com', accountOrigin: 'invited', mustChangePassword: true },
      })
    await expect(users.getRecordByEmail('invite@example.com')).resolves.toMatchObject({
      serverUserId: '42',
      invitation: { groupId: 'g-1' },
    })

    const failed = createHarness({ claim: new Error('circle membership could not be confirmed') })
    await expect(failed.service.signIn({ email: 'failed@example.com', password: 'temporary password 123' }))
      .rejects.toThrow('circle membership could not be confirmed')
    await expect(failed.users.getRecordByEmail('failed@example.com')).resolves.toBeNull()
  })

  it('rechecks invitations during registration and creates a protected owner session only when clear', async () => {
    const invited = createHarness({ invitation: { hasPendingInvite: true, groupName: 'Kasule Family', role: 'Family member' } })
    await expect(invited.service.register({
      name: 'Trevor', email: 'trevor@example.com', password: 'correct horse battery staple',
    })).rejects.toThrow('family invitation already exists')
    await expect(invited.users.getRecordByEmail('trevor@example.com')).resolves.toBeNull()

    const clear = createHarness()
    await expect(clear.service.register({
      name: 'Trevor', email: 'trevor@example.com', password: 'correct horse battery staple',
    })).resolves.toMatchObject({ status: 'onboarding', user: { accountOrigin: 'registered' } })
    await expect(clear.service.getState()).resolves.toMatchObject({ status: 'onboarding', user: { email: 'trevor@example.com' } })
  })

  it('rotates the invited session after initial password replacement and preserves prior profile progress', async () => {
    const { service, users } = createHarness()
    await service.signIn({ email: 'invite@example.com', password: 'temporary password 123' })
    const before = await users.getRecordByEmail('invite@example.com')

    await expect(service.setInitialPassword('my permanent password 123')).resolves.toMatchObject({
      status: 'onboarding', user: { mustChangePassword: false },
    })
    const after = await users.getRecordByEmail('invite@example.com')
    expect(after!.sessionVersion).toBe(before!.sessionVersion + 1)

    await expect(service.updateProfile('Trevor Kasule')).resolves.toMatchObject({
      status: 'onboarding', user: { name: 'Trevor Kasule' },
    })
    await expect(service.getState()).resolves.toMatchObject({ user: { name: 'Trevor Kasule' } })
  })

  it('confirms invited Circle context and rejects completion when expected membership disappears', async () => {
    const success = createHarness()
    await success.service.signIn({ email: 'invite@example.com', password: 'temporary password 123' })
    await success.service.setInitialPassword('my permanent password 123')
    await success.service.updateProfile('Trevor Kasule')
    await expect(success.service.getCircleContext()).resolves.toEqual({
      accountOrigin: 'invited',
      invitation: { groupId: 'g-1', groupName: 'Kasule Family', role: 'Family member' },
      groups: [{ id: 'g-1', name: 'Kasule Family', role: 'Family member' }],
    })
    await expect(success.service.complete('joined-circle')).resolves.toMatchObject({ status: 'authenticated' })

    const missing = createHarness({ memberships: [] })
    await missing.service.signIn({ email: 'invite@example.com', password: 'temporary password 123' })
    await expect(missing.service.complete('joined-circle')).rejects.toThrow('invited circle is not available yet')
  })

  it('accepts only owner completion actions for registered accounts', async () => {
    const owner = createHarness()
    await owner.service.register({ name: 'Trevor', email: 'owner@example.com', password: 'correct horse battery staple' })
    await expect(owner.service.complete('joined-circle')).rejects.toThrow('not valid for this account')
    await expect(owner.service.complete('home')).resolves.toMatchObject({ status: 'authenticated' })

    const owner2 = createHarness()
    await owner2.service.register({ name: 'Trevor', email: 'owner2@example.com', password: 'correct horse battery staple' })
    await expect(owner2.service.complete('create-circle')).resolves.toMatchObject({ status: 'authenticated' })
  })

  it('delegates recovery, clears sessions after reset, and signs out cleanly', async () => {
    const { service, recovery } = createHarness()
    await service.register({ name: 'Trevor', email: 'owner@example.com', password: 'correct horse battery staple' })

    await expect(service.requestPasswordReset('owner@example.com')).resolves.toMatchObject({ success: true, expiresInMinutes: 10 })
    expect(recovery.request).toHaveBeenCalledWith('owner@example.com')

    const resetInput = { email: 'owner@example.com', code: '12345678', newPassword: 'a new secure password 123' }
    await expect(service.resetPassword(resetInput)).resolves.toEqual({ success: true })
    expect(recovery.reset).toHaveBeenCalledWith(resetInput)
    await expect(service.restore()).resolves.toEqual({ status: 'unauthenticated' })

    await service.register({ name: 'Trevor Two', email: 'owner2@example.com', password: 'correct horse battery staple' })
    await expect(service.signOut()).resolves.toEqual({ success: true })
    await expect(service.restore()).resolves.toEqual({ status: 'unauthenticated' })
  })
})
