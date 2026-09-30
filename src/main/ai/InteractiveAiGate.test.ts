import { describe, expect, it } from 'vitest'
import { InteractiveAiGate } from './InteractiveAiGate'

describe('InteractiveAiGate', () => {
  it('lets background work continue immediately when no question is in progress', async () => {
    await expect(new InteractiveAiGate().waitUntilIdle()).resolves.toBeUndefined()
  })

  it('holds background work until every question in progress has finished', async () => {
    const gate = new InteractiveAiGate()
    const endFirst = gate.begin()
    const endSecond = gate.begin()
    let resumed = false
    const waiting = gate.waitUntilIdle().then(() => { resumed = true })

    endFirst()
    await Promise.resolve()
    expect(resumed).toBe(false)
    endFirst()
    await Promise.resolve()
    expect(resumed).toBe(false)

    endSecond()
    await waiting
    expect(resumed).toBe(true)
  })
})
