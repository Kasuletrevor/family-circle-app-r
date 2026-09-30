/**
 * Gives questions priority over background indexing. The embedding and answer
 * servers share the CPU, and llama.cpp threads busy-wait, so running both at once
 * slowed a short answer from ~2 s to ~27 s on a 4-core laptop. Indexing waits between
 * chunks while any question is being answered.
 */
export class InteractiveAiGate {
  private active = 0
  private waiters: Array<() => void> = []

  /** Marks a question as in progress; call the returned function when it finishes. */
  begin(): () => void {
    this.active += 1
    let ended = false
    return () => {
      if (ended) return
      ended = true
      this.active -= 1
      if (this.active === 0) {
        const waiters = this.waiters
        this.waiters = []
        for (const resolve of waiters) resolve()
      }
    }
  }

  /** Resolves immediately when no question is in progress, otherwise when the last one ends. */
  waitUntilIdle(): Promise<void> {
    if (this.active === 0) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push(resolve))
  }
}
