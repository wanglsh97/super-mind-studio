import {
  OpenSandboxRuntime,
  type CreateOpenSandboxClientInput,
  type OpenSandboxClient,
  type OpenSandboxInstance,
} from './open-sandbox-runtime'

class TestOpenSandboxClient implements OpenSandboxClient {
  private readonly instances = new Map<string, TestOpenSandboxInstance>()
  private sequence = 0

  async healthCheck(): Promise<void> {}

  async create(input: CreateOpenSandboxClientInput): Promise<OpenSandboxInstance> {
    const instance = new TestOpenSandboxInstance(`test-${++this.sequence}`, input)
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
    if (!instance) throw new Error('not found')
    await instance.kill()
  }

  async close(): Promise<void> {}
}

class TestOpenSandboxInstance implements OpenSandboxInstance {
  private readonly files = new Map<string, Uint8Array>()
  private readonly createdAt = new Date()
  private ready = false
  private killed = false

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
    const commandId = `${this.id}-command`
    input.onInit(commandId)
    if (input.command.startsWith('python3 -c ')) {
      this.materializeDataUrlDownload(input.command)
    } else if (input.command === 'echo contract') {
      input.onStdout('contract\n')
    } else if (input.command === 'node scripts/clean.mjs') {
      input.onStdout('cleaned\n')
    }
    return {
      id: commandId,
      exitCode: 0,
      durationMs: input.command === 'node scripts/clean.mjs' ? 12 : 5,
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

  async getEndpointUrl(port: number) {
    return `http://127.0.0.1:${port}`
  }

  async getSignedEndpoint(port: number, expires: number) {
    return { endpoint: `preview.invalid/${this.id}/${port}?expires=${expires}` }
  }

  async interrupt(): Promise<void> {}

  async kill(): Promise<void> {
    this.killed = true
  }

  async close(): Promise<void> {}

  private materializeDataUrlDownload(command: string): void {
    const encodedScript = command.match(/base64\.b64decode\('([^']+)'\)/)?.[1]
    if (!encodedScript) throw new Error('download script is missing')
    const script = Buffer.from(encodedScript, 'base64').toString('utf8')
    const encodedUrl = script.match(/url = base64\.b64decode\("([^"]+)"\)/)?.[1]
    const encodedPath = script.match(/path = base64\.b64decode\("([^"]+)"\)/)?.[1]
    if (!encodedUrl || !encodedPath) throw new Error('download metadata is missing')
    const url = Buffer.from(encodedUrl, 'base64').toString('utf8')
    const path = Buffer.from(encodedPath, 'base64').toString('utf8')
    const payload = url.match(/^data:application\/zip;base64,(.+)$/)?.[1]
    if (!payload) throw new Error('test download must use a data URL')
    this.files.set(path, Uint8Array.from(Buffer.from(payload, 'base64')))
  }
}

export function createOpenSandboxRuntimeTestDouble(): OpenSandboxRuntime {
  return new OpenSandboxRuntime({
    domain: 'sandbox.test:8080',
    apiKey: 'test-key',
    image: 'example.test/sandbox:v1',
    client: new TestOpenSandboxClient(),
  })
}
