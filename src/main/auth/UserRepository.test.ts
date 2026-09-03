import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../database/migrations'
import { hashPassword } from './passwordCrypto'
import { UserRepository } from './UserRepository'

const databases: DatabaseSync[] = []

function freshRepository(): { db: DatabaseSync; repository: UserRepository } {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  runMigrations(db)
  return { db, repository: new UserRepository(db) }
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

describe('UserRepository', () => {
  it('creates a registered user transactionally with normalized email and family-visible name', async () => {
    const { repository } = freshRepository()
    const user = await repository.createRegisteredUser({
      name: 'Trevor Kasule',
      email: ' Trevor@Example.COM ',
      password: 'correct horse battery staple',
    })

    expect(user).toMatchObject({
      email: 'trevor@example.com',
      name: 'Trevor Kasule',
      accountOrigin: 'registered',
      mustChangePassword: false,
      onboardingCompleted: false,
    })
    await expect(repository.createRegisteredUser({
      name: 'Duplicate',
      email: 'TREVOR@example.com',
      password: 'another secure password',
    })).rejects.toThrow('Email already registered')
  })

  it('verifies a bcrypt hash migrated from Jose\'s password column', async () => {
    const db = new DatabaseSync(':memory:')
    databases.push(db)
    const legacyHash = await hashPassword('legacy password 1234')
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL)`)
    db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run('legacy@example.com', legacyHash)
    runMigrations(db)
    const repository = new UserRepository(db)

    await expect(repository.verifyPassword(1, 'legacy password 1234')).resolves.toBe(true)
    await expect(repository.verifyPassword(1, 'wrong password')).resolves.toBe(false)
  })

  it('creates invited users with claim metadata and onboarding flags', async () => {
    const { repository } = freshRepository()
    const user = await repository.createInvitedUser({
      name: 'Invited Person',
      email: 'invite@example.com',
      password: 'temporary password 123',
      serverUserId: '42',
      invitation: { groupId: 'g-1', groupName: 'Kasule Family', role: 'Family member' },
    })
    const record = await repository.getRecordById(user.id)

    expect(user).toMatchObject({ accountOrigin: 'invited', mustChangePassword: true, onboardingCompleted: false })
    expect(record).toMatchObject({
      serverUserId: '42',
      activeCircleId: null,
      sessionVersion: 0,
      invitation: { groupId: 'g-1', groupName: 'Kasule Family', role: 'Family member' },
    })
  })

  it('persists the resolved shared identity and local active Circle independently', async () => {
    const { repository } = freshRepository()
    const user = await repository.createRegisteredUser({
      name: 'Trevor Kasule',
      email: 'trevor@example.com',
      password: 'correct horse battery staple',
    })

    await repository.setServerUserId(user.id, '88')
    await repository.setActiveCircleId(user.id, 'circle-a')

    const record = await repository.getRecordById(user.id)
    expect(record?.serverUserId).toBe('88')
    expect(record?.activeCircleId).toBe('circle-a')

    await repository.setActiveCircleId(user.id, null)
    await expect(repository.getRecordById(user.id)).resolves.toMatchObject({ activeCircleId: null })
  })

  it('updates profile and replaces the initial password while rotating sessionVersion', async () => {
    const { repository } = freshRepository()
    const user = await repository.createInvitedUser({
      name: 'invite@example.com',
      email: 'invite@example.com',
      password: 'temporary password 123',
      serverUserId: '42',
      invitation: { groupId: 'g-1', groupName: 'Kasule Family', role: 'Family member' },
    })

    const profiled = await repository.updateProfile(user.id, 'Trevor Kasule')
    expect(profiled.name).toBe('Trevor Kasule')

    const replaced = await repository.replacePassword(user.id, 'my permanent password 123', { clearMustChangePassword: true })
    expect(replaced.mustChangePassword).toBe(false)
    await expect(repository.getSessionVersion(user.id)).resolves.toBe(1)
    await expect(repository.verifyPassword(user.id, 'my permanent password 123')).resolves.toBe(true)
    await expect(repository.verifyPassword(user.id, 'temporary password 123')).resolves.toBe(false)
  })

  it('marks onboarding complete without exposing the password hash in AuthUser', async () => {
    const { repository } = freshRepository()
    const user = await repository.createRegisteredUser({
      name: 'Trevor',
      email: 'trevor@example.com',
      password: 'correct horse battery staple',
    })

    const completed = await repository.markOnboardingComplete(user.id)
    expect(completed.onboardingCompleted).toBe(true)
    expect(completed).not.toHaveProperty('passwordHash')
  })
})
