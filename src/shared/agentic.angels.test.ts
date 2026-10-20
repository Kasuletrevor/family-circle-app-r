import { describe, expect, it } from 'vitest'
import { isMyGuardianAngel, publicAngel, safeAngelConnection, type MyGuardianAngel } from './agentic'

const angel: MyGuardianAngel = {
  id: '5', name: 'Morning Check-in', description: 'Says good morning', templateId: '7', templateName: 'Elder Companion',
  avatar: null, usesCloudAi: true, runCount: 2, lastRunAt: '2026-10-01T10:00:00.000Z',
  trustBoundaries: ['No medical advice'], escalationTriggers: [],
}

describe('My Guardian Angels shapes', () => {
  it('accepts a valid angel and rejects unsafe fields', () => {
    expect(isMyGuardianAngel(angel)).toBe(true)
    expect(isMyGuardianAngel({ ...angel, templateId: null, templateName: null, lastRunAt: null })).toBe(true)
    for (const bad of [
      { id: '../5' }, { name: '' }, { avatar: 'https://evil.test/a.png' }, { runCount: -1 }, { runCount: 1.5 },
      { lastRunAt: 'yesterday' }, { templateId: 'x' }, { usesCloudAi: 'yes' }, { trustBoundaries: 'none' },
    ]) {
      expect(isMyGuardianAngel({ ...angel, ...bad })).toBe(false)
    }
  })

  it('keeps only the public fields', () => {
    expect(publicAngel({ ...angel, created_by: 'owner@example.test' } as never)).toEqual(angel)
  })

  it('keeps only known connection states', () => {
    expect(safeAngelConnection({ status: 'connected', email: 'pat@example.test', token: 'secret' }))
      .toEqual({ status: 'connected', email: 'pat@example.test' })
    expect(safeAngelConnection({ status: 'connected', email: 'not an email' })).toEqual({ status: 'connected', email: null })
    expect(safeAngelConnection({ status: 'connecting', verifier: 'x' })).toEqual({ status: 'connecting' })
    expect(safeAngelConnection({ status: 'disconnected', problem: 'ended' })).toEqual({ status: 'disconnected', problem: 'ended' })
    expect(safeAngelConnection({ status: 'disconnected', problem: 'other' })).toEqual({ status: 'disconnected' })
    expect(safeAngelConnection('connected')).toEqual({ status: 'disconnected' })
  })
})
