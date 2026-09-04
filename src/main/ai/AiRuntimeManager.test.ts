import { describe, expect, it, vi } from 'vitest'
import { AiRuntimeManager } from './AiRuntimeManager'
import type { InstalledAiPaths } from './privateAiModels'

const INSTALLED: InstalledAiPaths = {
  llamaDir: 'C:/FamilyCircle/offline-ai/bin/runtime',
  serverExe: 'C:/FamilyCircle/offline-ai/bin/runtime/llama-server.exe',
  graniteModel: 'C:/FamilyCircle/offline-ai/models/granite.gguf',
  nomicModel: 'C:/FamilyCircle/offline-ai/models/nomic.gguf',
}

class FakeChild {
  killed = false
  readonly listeners: Array<() => void> = []

  kill(): boolean {
    this.killed = true
    return true
  }

  once(_event: 'exit' | 'error', listener: () => void): this {
    this.listeners.push(listener)
    return this
  }
}

function makeHarness(options: { installed?: InstalledAiPaths | null; health?: boolean[] } = {}) {
  const children: FakeChild[] = []
  const process = {
    spawn: vi.fn(() => {
      const child = new FakeChild()
      children.push(child)
      return child
    }),
  }
  const healthValues = [...(options.health ?? [true])]
  const health = {
    check: vi.fn(async () => healthValues.length > 1 ? healthValues.shift()! : (healthValues[0] ?? true)),
  }
  const assets = {
    getInstalledPaths: vi.fn(async () => options.installed === undefined ? INSTALLED : options.installed),
  }
  const sleep = vi.fn(async () => undefined)
  const manager = new AiRuntimeManager({ assets, process, health, sleep, cpuCount: () => 4 })
  return { manager, assets, process, health, sleep, children }
}

describe('AiRuntimeManager lazy split runtimes', () => {
  it('starts nothing at construction', () => {
    const { process } = makeHarness()
    expect(process.spawn).not.toHaveBeenCalled()
  })

  it('starts only Nomic for embedding request', async () => {
    const { manager, process } = makeHarness()

    await expect(manager.ensureEmbeddingRuntime()).resolves.toBe(true)

    expect(process.spawn).toHaveBeenCalledTimes(1)
    expect(process.spawn.mock.calls[0]?.[0]).toBe(INSTALLED.serverExe)
    expect(process.spawn.mock.calls[0]?.[1]).toEqual([
      '--model', INSTALLED.nomicModel,
      '--port', '8081',
      '--threads', '4',
      '--ctx-size', '2048',
      '--embeddings',
      '--pooling', 'mean',
    ])
    expect(process.spawn.mock.calls[0]?.[2]).toMatchObject({ windowsHide: true })
  })

  it('starts only Granite for generation request', async () => {
    const { manager, process } = makeHarness()

    await expect(manager.ensureGenerationRuntime()).resolves.toBe(true)

    expect(process.spawn).toHaveBeenCalledTimes(1)
    expect(process.spawn.mock.calls[0]?.[1]).toEqual([
      '--model', INSTALLED.graniteModel,
      '--port', '8080',
      '--threads', '4',
      '--ctx-size', '4096',
    ])
  })

  it('reuses healthy managed process', async () => {
    const { manager, process } = makeHarness({ health: [true, true] })

    await manager.ensureEmbeddingRuntime()
    await manager.ensureEmbeddingRuntime()

    expect(process.spawn).toHaveBeenCalledTimes(1)
  })

  it('restarts unhealthy managed process', async () => {
    const { manager, process, children } = makeHarness({ health: [true, false, true] })

    await manager.ensureEmbeddingRuntime()
    await manager.ensureEmbeddingRuntime()

    expect(process.spawn).toHaveBeenCalledTimes(2)
    expect(children[0]?.killed).toBe(true)
    expect(children[1]?.killed).toBe(false)
  })

  it('returns false without verified assets', async () => {
    const { manager, process } = makeHarness({ installed: null })

    await expect(manager.ensureEmbeddingRuntime()).resolves.toBe(false)
    await expect(manager.ensureGenerationRuntime()).resolves.toBe(false)
    expect(process.spawn).not.toHaveBeenCalled()
  })

  it('stops both managed children', async () => {
    const { manager, children } = makeHarness({ health: [true, true, true, true] })
    await manager.ensureEmbeddingRuntime()
    await manager.ensureGenerationRuntime()

    manager.stopAll()

    expect(children).toHaveLength(2)
    expect(children.every((child) => child.killed)).toBe(true)
  })

  it('kills only the failed managed child after the 60-second startup timeout', async () => {
    const { manager, process, children, health, sleep } = makeHarness({ health: Array(130).fill(false) })

    await expect(manager.ensureEmbeddingRuntime()).resolves.toBe(false)

    expect(process.spawn).toHaveBeenCalledTimes(1)
    expect(children[0]?.killed).toBe(true)
    expect(health.check.mock.calls.length).toBeGreaterThanOrEqual(120)
    expect(sleep.mock.calls.length).toBeGreaterThanOrEqual(119)
  })
})
