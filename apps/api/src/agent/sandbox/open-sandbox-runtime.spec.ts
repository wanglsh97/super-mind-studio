import {
  OpenSandboxRuntime,
  type CreateOpenSandboxClientInput,
  type OpenSandboxClient,
  type OpenSandboxInstance,
} from './open-sandbox-runtime'
import { sandboxRuntimeContract } from './sandbox-runtime.contract'

class StubOpenSandboxClient implements OpenSandboxClient {
  private readonly instances = new Map<string, StubOpenSandboxInstance>()
  private sequence = 0

  async create(input: CreateOpenSandboxClientInput): Promise<OpenSandboxInstance> {
    const instance = new StubOpenSandboxInstance(`stub-${++this.sequence}`, input)
    this.instances.set(instance.id, instance)
    return instance
  }

  async connect(sandboxId: string): Promise<OpenSandboxInstance> {
    const instance = this.instances.get(sandboxId)
    if (!instance) throw new Error('not found')
    return instance
  }

  async listOwned() {
    return [...this.instances.values()].map((instance) => instance.info())
  }

  async kill(sandboxId: string): Promise<void> {
    const instance = this.instances.get(sandboxId)
    if (!instance || instance.killed) throw new Error('not found')
    await instance.kill()
  }

  async close(): Promise<void> {}
}

class StubOpenSandboxInstance implements OpenSandboxInstance {
  readonly files = new Map<string, Uint8Array>()
  killed = false
  private ready = false
  private readonly createdAt = new Date('2026-07-26T00:00:00.000Z')

  constructor(
    readonly id: string,
    private readonly creation: CreateOpenSandboxClientInput,
  ) {}

  info() {
    return {
      id: this.id,
      status: this.killed ? 'Deleted' : this.ready ? 'Running' : 'Creating',
      createdAt: this.createdAt,
      expiresAt: new Date(this.createdAt.getTime() + this.creation.timeoutSeconds * 1_000),
      metadata: this.creation.metadata,
    }
  }

  async getInfo() {
    return this.info()
  }

  async waitUntilReady(): Promise<void> {
    this.ready = true
  }

  async runCommand(input: {
    command: string
    onInit(commandId: string): void
    onStdout(content: string): void
  }) {
    input.onInit(`${this.id}-command`)
    if (input.command === 'echo contract') input.onStdout('contract\n')
    return {
      id: `${this.id}-command`,
      exitCode: 0,
      durationMs: 5,
      stdout: '',
      stderr: '',
    }
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, Uint8Array.from(bytes))
  }

  async readFile(path: string): Promise<Uint8Array | null> {
    const bytes = this.files.get(path)
    return bytes ? Uint8Array.from(bytes) : null
  }

  async getMetrics() {
    return { memoryUsedMiB: 32 }
  }

  async interrupt(): Promise<void> {}

  async kill(): Promise<void> {
    this.killed = true
  }

  async close(): Promise<void> {}
}

function createRuntime(client = new StubOpenSandboxClient()) {
  return new OpenSandboxRuntime({
    domain: 'sandbox.internal:8080',
    apiKey: 'test-key',
    image: 'example.test/sandbox:v1',
    now: () => new Date('2026-07-26T00:00:01.000Z'),
    client,
  })
}

sandboxRuntimeContract('OpenSandbox', () => {
  const runtime = createRuntime()
  return { runtime, dispose: () => runtime.onModuleDestroy() }
})

describe('OpenSandboxRuntime adapter mapping', () => {
  it('maps accepted resource limits and runtime ownership metadata into SDK creation', async () => {
    const client = new StubOpenSandboxClient()
    const create = jest.spyOn(client, 'create')
    const runtime = createRuntime(client)

    await runtime.createSandbox({ runId: 'run-resource' })

    expect(create).toHaveBeenCalledWith({
      image: 'example.test/sandbox:v1',
      timeoutSeconds: 120,
      cpu: '1',
      memory: '1024Mi',
      metadata: {
        'aigateway.owner': 'ai-gateway-studio',
        'aigateway.run-id': 'run-resource',
      },
    })
    await runtime.onModuleDestroy()
  })

  it('lists only expired owned sandboxes as leaks', async () => {
    const client = new StubOpenSandboxClient()
    const runtime = createRuntime(client)
    await runtime.createSandbox({
      runId: 'expired',
      limits: { sandboxTimeoutMs: 500 },
    })

    await expect(
      runtime.listLeakedSandboxes(new Date('2026-07-26T00:00:01.000Z')),
    ).resolves.toEqual([
      expect.objectContaining({
        runId: 'expired',
        status: 'failed',
      }),
    ])
    await runtime.onModuleDestroy()
  })
})
