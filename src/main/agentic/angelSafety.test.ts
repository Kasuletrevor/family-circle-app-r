import { describe, expect, it } from 'vitest'
import { ESCALATION_REPLIES, escalationFor } from './angelSafety'

describe('escalationFor', () => {
  it('always catches self-harm, emergencies and abuse, whatever the angel', () => {
    expect(escalationFor('Some days I want to end my life', [])).toBe('self-harm')
    expect(escalationFor('I want to die', [])).toBe('self-harm')
    expect(escalationFor("I have chest pain and can't breathe", [])).toBe('medical-emergency')
    expect(escalationFor('I fell in the bathroom', [])).toBe('medical-emergency')
    expect(escalationFor('My carer hits me', [])).toBe('abuse')
  })

  it('adds groups only when the angel has the trigger', () => {
    expect(escalationFor("I don't know where I am", [])).toBeNull()
    expect(escalationFor("I don't know where I am", ['severe_confusion'])).toBe('confusion')
    expect(escalationFor('I feel hopeless and panicking', ['extreme_distress'])).toBe('distress')
    expect(escalationFor('Someone asked for my bank password', ['privacy_or_security_concern'])).toBe('privacy')
  })

  it('ignores everyday words and unknown trigger keys', () => {
    for (const message of [
      'I killed it at bingo today, my chest of drawers is full',
      'The film was to die for',
      'I fell asleep early last night',
      'We had a lovely visit',
    ]) {
      expect(escalationFor(message, ['made_up_trigger', 'severe_confusion', 'extreme_distress'])).toBeNull()
    }
  })

  it('gives a fixed reply for every group without phone numbers', () => {
    for (const reply of Object.values(ESCALATION_REPLIES)) {
      expect(reply.length).toBeGreaterThan(20)
      expect(reply).not.toMatch(/\d{3}/)
    }
  })
})
