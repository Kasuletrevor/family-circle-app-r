import { spawn as nodeSpawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { availableParallelism } from 'node:os'
import type { InstalledAiPaths } from './privateAiModels'

const EMBEDDING_PORT = 8081
const GENERATION_PORT = 8080
const STARTUP_POLL_MS = 500
const STARTUP_ATTEMPTS = 120

export interface AiRuntimeAssetSource {
  getInstalledPaths(): Promise<InstalledAiPaths | null>
}

export interface ManagedAiChild {
  kill(): boolean
  once(event: 'exit' | 'error', listener: () => void): this
}

export interface AiRuntimeProcessPort {
  spawn(executable: string, args: string[], options: { windowsHide: boolean }): ManagedAiChild
}

export interface AiRuntimeHealthPort {
  check(port: number): Promise<boolean>
}

interface AiRuntimeManagerDependencies {
  assets: AiRuntimeAssetSource
  process?: AiRuntimeProcessPort
  health?: AiRuntimeHealthPort
  sleep?: (milliseconds: number) => Promise<void>
  cpuCount?: () => number
}

type RuntimeKind = 'embedding' | 'generation'

class NodeRuntimeProcessPort implements AiRuntimeProcessPort {
  spawn(executable: string, args: string[], options: { windowsHide: boolean }): ManagedAiChild {
    return nodeSpawn(executable, args, {
      windowsHide: options.windowsHide,
      stdio: 'ignore',
    }) as unknown as ManagedAiChild
  }
}

class LocalHealthPort implements AiRuntimeHealthPort {
  async check(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (healthy: boolean) => {
        if (settled) return
        settled = true
        resolve(healthy)
      }

      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/health',
          method: 'GET',
          timeout: 1_000,
        },
        (response) => {
          response.resume()
          finish((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300)
        },
      )
      request.once('timeout', () => {
        request.destroy()
        finish(false)
      })
      request.once('error', () => finish(false))
      request.end()
    })
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class AiRuntimeManager {
  private readonly process: AiRuntimeProcessPort
  private readonly health: AiRuntimeHealthPort
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly cpuCount: () => number
  private embeddingChild: ManagedAiChild | null = null
  private generationChild: ManagedAiChild | null = null

  constructor(private readonly dependencies: AiRuntimeManagerDependencies) {
    this.process = dependencies.process ?? new NodeRuntimeProcessPort()
    this.health = dependencies.health ?? new LocalHealthPort()
    this.sleep = dependencies.sleep ?? defaultSleep
    this.cpuCount = dependencies.cpuCount ?? (() => Math.max(1, availableParallelism()))
  }

  async ensureEmbeddingRuntime(): Promise<boolean> {
    return this.ensureRuntime('embedding')
  }

  async ensureGenerationRuntime(): Promise<boolean> {
    return this.ensureRuntime('generation')
  }

  stopAll(): void {
    this.stopManagedChild('embedding')
    this.stopManagedChild('generation')
  }

  private async ensureRuntime(kind: RuntimeKind): Promise<boolean> {
    const port = this.portFor(kind)
    const existing = this.childFor(kind)
    if (existing) {
      if (await this.health.check(port)) return true
      this.stopManagedChild(kind)
    }

    const installed = await this.dependencies.assets.getInstalledPaths()
    if (!installed) return false

    const child = this.process.spawn(installed.serverExe, this.argsFor(kind, installed), { windowsHide: true })
    this.setChild(kind, child)
    const clearIfCurrent = () => {
      if (this.childFor(kind) === child) this.setChild(kind, null)
    }
    child.once('exit', clearIfCurrent)
    child.once('error', clearIfCurrent)

    for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
      if (await this.health.check(port)) return true
      if (attempt < STARTUP_ATTEMPTS - 1) await this.sleep(STARTUP_POLL_MS)
    }

    if (this.childFor(kind) === child) {
      child.kill()
      this.setChild(kind, null)
    }
    return false
  }

  private argsFor(kind: RuntimeKind, installed: InstalledAiPaths): string[] {
    const threads = String(Math.max(1, Math.floor(this.cpuCount())))
    if (kind === 'embedding') {
      return [
        '--model', installed.nomicModel,
        '--port', String(EMBEDDING_PORT),
        '--threads', threads,
        '--ctx-size', '2048',
        '--embeddings',
        '--pooling', 'mean',
      ]
    }

    return [
      '--model', installed.graniteModel,
      '--port', String(GENERATION_PORT),
      '--threads', threads,
      '--ctx-size', '4096',
    ]
  }

  private portFor(kind: RuntimeKind): number {
    return kind === 'embedding' ? EMBEDDING_PORT : GENERATION_PORT
  }

  private childFor(kind: RuntimeKind): ManagedAiChild | null {
    return kind === 'embedding' ? this.embeddingChild : this.generationChild
  }

  private setChild(kind: RuntimeKind, child: ManagedAiChild | null): void {
    if (kind === 'embedding') this.embeddingChild = child
    else this.generationChild = child
  }

  private stopManagedChild(kind: RuntimeKind): void {
    const child = this.childFor(kind)
    if (!child) return
    child.kill()
    if (this.childFor(kind) === child) this.setChild(kind, null)
  }
}
