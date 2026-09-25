import { describe, expect, it } from 'vitest'
import { AsyncMutationLock } from './MutationLock'

describe('AsyncMutationLock', () => {
  it('serializes overlapping local mutations', async () => {
    const lock = new AsyncMutationLock()
    const events: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })

    const first = lock.runExclusive(async () => {
      events.push('first:start')
      await firstGate
      events.push('first:end')
    })

    const second = lock.runExclusive(async () => {
      events.push('second:start')
      events.push('second:end')
    })

    await Promise.resolve()
    expect(events).toEqual(['first:start'])

    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('releases the queue after a failed mutation', async () => {
    const lock = new AsyncMutationLock()
    await expect(lock.runExclusive(async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')

    await expect(lock.runExclusive(async () => 'next')).resolves.toBe('next')
  })
})
