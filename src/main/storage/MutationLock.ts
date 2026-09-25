export interface MutationLock {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>
}

export class AsyncMutationLock implements MutationLock {
  private tail: Promise<void> = Promise.resolve()

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export const noMutationLock: MutationLock = {
  runExclusive: (operation) => operation(),
}
