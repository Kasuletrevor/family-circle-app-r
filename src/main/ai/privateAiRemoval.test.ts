import { describe, expect, it, vi } from 'vitest'
import { AsyncMutationLock } from '../storage/MutationLock'
import type { PrivateAiSetupStatus } from './privateAiModels'
import { createPrivateAiRemoval } from './privateAiRemoval'

const notInstalled = { state: 'not_installed' } as PrivateAiSetupStatus

describe('createPrivateAiRemoval', () => {
  it('stops runtimes before removing assets', async () => {
    const order: string[] = []
    const remove = createPrivateAiRemoval({
      mutationLock: new AsyncMutationLock(),
      stopRuntimes: vi.fn(async () => { order.push('stopped') }),
      removeAssets: vi.fn(async () => {
        order.push('removed')
        return notInstalled
      }),
    })

    await expect(remove()).resolves.toBe(notInstalled)
    expect(order).toEqual(['stopped', 'removed'])
  })

  it('waits for an in-flight locked indexing job before stopping runtimes', async () => {
    const lock = new AsyncMutationLock()
    const order: string[] = []
    let finishIndexing!: () => void
    const indexing = lock.runExclusive(() => new Promise<void>((resolve) => {
      order.push('indexing')
      finishIndexing = () => {
        order.push('indexed')
        resolve()
      }
    }))

    const removal = createPrivateAiRemoval({
      mutationLock: lock,
      stopRuntimes: async () => { order.push('stopped') },
      removeAssets: async () => {
        order.push('removed')
        return notInstalled
      },
    })()

    await Promise.resolve()
    expect(order).toEqual(['indexing'])
    finishIndexing()
    await Promise.all([indexing, removal])
    expect(order).toEqual(['indexing', 'indexed', 'stopped', 'removed'])
  })

  it('does not remove assets when runtimes fail to stop', async () => {
    const removeAssets = vi.fn(async () => notInstalled)
    const remove = createPrivateAiRemoval({
      mutationLock: new AsyncMutationLock(),
      stopRuntimes: async () => { throw new Error('stuck') },
      removeAssets,
    })

    await expect(remove()).rejects.toThrow('stuck')
    expect(removeAssets).not.toHaveBeenCalled()
  })
})
