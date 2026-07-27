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

  async healthCheck(): Promise<void> {}

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

  async ensureDirectory(): Promise<void> {}

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
  it('retries a failed health check exactly once', async () => {
    const client = new StubOpenSandboxClient()
    const healthCheck = jest
      .spyOn(client, 'healthCheck')
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce()
    const runtime = createRuntime(client)

    await expect(runtime.healthCheck()).resolves.toBeUndefined()
    expect(healthCheck).toHaveBeenCalledTimes(2)
    await runtime.onModuleDestroy()
  })

  it('does not retry sandbox creation because it is not idempotent', async () => {
    const client = new StubOpenSandboxClient()
    const create = jest.spyOn(client, 'create').mockRejectedValue(new Error('network failure'))
    const runtime = createRuntime(client)

    await expect(runtime.createSandbox({ runId: 'run-create-failed' })).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE',
      retryable: true,
    })
    expect(create).toHaveBeenCalledTimes(1)
    await runtime.onModuleDestroy()
  })

  it('compensates an SDK sandbox created before metadata inspection fails', async () => {
    const client = new StubOpenSandboxClient()
    const instance = new StubOpenSandboxInstance('partial', {
      image: 'example.test/sandbox:v1',
      timeoutSeconds: 120,
      cpu: '1',
      memory: '1024Mi',
      metadata: {},
    })
    const kill = jest.spyOn(instance, 'kill')
    const close = jest.spyOn(instance, 'close')
    jest.spyOn(instance, 'getInfo').mockRejectedValue(new Error('inspect failed'))
    jest.spyOn(client, 'create').mockResolvedValue(instance)
    const runtime = createRuntime(client)

    await expect(runtime.createSandbox({ runId: 'run-partial' })).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE',
    })
    expect(kill).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    await runtime.onModuleDestroy()
  })

  it('retains local state after a network-interrupted destroy so the call can be retried', async () => {
    const client = new StubOpenSandboxClient()
    const runtime = createRuntime(client)
    const sandbox = await runtime.createSandbox({ runId: 'run-destroy-retry' })
    const instance = (await client.connect(sandbox.sandboxId)) as StubOpenSandboxInstance
    const kill = jest
      .spyOn(instance, 'kill')
      .mockRejectedValueOnce(new Error('network failure'))
      .mockImplementationOnce(async () => {
        instance.killed = true
      })

    await expect(runtime.destroySandbox(sandbox.sandboxId)).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE',
    })
    await expect(runtime.destroySandbox(sandbox.sandboxId)).resolves.toBeUndefined()
    await expect(runtime.destroySandbox(sandbox.sandboxId)).resolves.toBeUndefined()
    expect(kill).toHaveBeenCalledTimes(2)
    await runtime.onModuleDestroy()
  })

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

  it('treats an SDK structured 404 as a missing file before first write', async () => {
    const client = new StubOpenSandboxClient()
    const runtime = createRuntime(client)
    const sandbox = await runtime.createSandbox({ runId: 'run-first-write' })
    await runtime.waitUntilReady(sandbox.sandboxId)
    const instance = (await client.connect(sandbox.sandboxId)) as StubOpenSandboxInstance
    jest.spyOn(instance, 'readFile').mockRejectedValueOnce({
      statusCode: 404,
      rawBody: '{"code":"FILE_NOT_FOUND"}',
    })

    await expect(
      runtime.writeFile({
        sandboxId: sandbox.sandboxId,
        path: '/workspace/input/new.txt',
        bytes: new TextEncoder().encode('new'),
      }),
    ).resolves.toMatchObject({ path: '/workspace/input/new.txt' })
    await runtime.onModuleDestroy()
  })

  it('creates the requested workspace cwd before running a command', async () => {
    const client = new StubOpenSandboxClient()
    const runtime = createRuntime(client)
    const sandbox = await runtime.createSandbox({ runId: 'run-cwd' })
    await runtime.waitUntilReady(sandbox.sandboxId)
    const instance = (await client.connect(sandbox.sandboxId)) as StubOpenSandboxInstance
    const ensureDirectory = jest.spyOn(instance, 'ensureDirectory')

    await runtime.runCommand({
      sandboxId: sandbox.sandboxId,
      command: 'pwd',
      workingDirectory: '/workspace/work/nested',
    })

    expect(ensureDirectory).toHaveBeenCalledWith('/workspace/work/nested')
    await runtime.onModuleDestroy()
  })

  it('reads a regular file only after its real path is verified inside /workspace/output', async () => {
    const client = new StubOpenSandboxClient()
    const runtime = createRuntime(client)
    const sandbox = await runtime.createSandbox({ runId: 'run-output-read' })
    await runtime.waitUntilReady(sandbox.sandboxId)
    const instance = (await client.connect(sandbox.sandboxId)) as StubOpenSandboxInstance
    instance.files.set(
      '/workspace/output/logo.svg',
      new TextEncoder().encode('<svg aria-label="logo"/>'),
    )
    jest.spyOn(instance, 'runCommand').mockResolvedValueOnce({
      id: 'verify-output',
      exitCode: 0,
      durationMs: 1,
      stdout: '/workspace/output/logo.svg',
      stderr: '',
    })

    await expect(
      runtime.readOutputFile(sandbox.sandboxId, '/workspace/output/logo.svg'),
    ).resolves.toMatchObject({
      path: '/workspace/output/logo.svg',
      sizeBytes: 24,
    })
    await runtime.onModuleDestroy()
  })

  it('returns null for a missing output and rejects symlinks or escaped real paths', async () => {
    const client = new StubOpenSandboxClient()
    const runtime = createRuntime(client)
    const sandbox = await runtime.createSandbox({ runId: 'run-output-boundary' })
    await runtime.waitUntilReady(sandbox.sandboxId)
    const instance = (await client.connect(sandbox.sandboxId)) as StubOpenSandboxInstance
    const runCommand = jest.spyOn(instance, 'runCommand')
    runCommand.mockResolvedValueOnce({
      id: 'verify-missing',
      exitCode: 44,
      durationMs: 1,
      stdout: '',
      stderr: '',
    })
    runCommand.mockResolvedValueOnce({
      id: 'verify-symlink',
      exitCode: 45,
      durationMs: 1,
      stdout: '',
      stderr: '',
    })

    await expect(
      runtime.readOutputFile(sandbox.sandboxId, '/workspace/output/missing.txt'),
    ).resolves.toBeNull()
    await expect(
      runtime.readOutputFile(sandbox.sandboxId, '/workspace/output/secret-link'),
    ).rejects.toMatchObject({
      code: 'FILE_ACCESS_DENIED',
      retryable: false,
    })
    await expect(
      runtime.readOutputFile(sandbox.sandboxId, '/workspace/work/private.txt'),
    ).rejects.toMatchObject({
      code: 'FILE_ACCESS_DENIED',
      retryable: false,
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
