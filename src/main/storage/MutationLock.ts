import { AsyncLocalStorage } from 'node:async_hooks'

export interface MutationLock {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>
}

export class AsyncMutationLock implements MutationLock {
  private tail: Promise<void> = Promise.resolve()
  private readonly ownership = new AsyncLocalStorage<boolean>()

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.ownership.getStore() === true) return operation()

    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous
    try {
      return await this.ownership.run(true, operation)
    } finally {
      release()
    }
  }
}

export const noMutationLock: MutationLock = {
  runExclusive: (operation) => operation(),
}
