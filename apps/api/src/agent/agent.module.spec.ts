import { ConfigService } from '@nestjs/config'

import { createSandboxRuntime } from './agent.module'
import { FakeSandboxRuntime } from './sandbox/fake-sandbox-runtime'
import { OpenSandboxRuntime } from './sandbox/open-sandbox-runtime'

describe('createSandboxRuntime', () => {
  it('keeps deterministic Fake runtime as the default', () => {
    const fake = new FakeSandboxRuntime()

    expect(createSandboxRuntime(new ConfigService(), fake)).toBe(fake)
  })

  it('selects the OpenSandbox adapter only when explicitly configured', async () => {
    const runtime = createSandboxRuntime(
      new ConfigService({
        SANDBOX_RUNTIME_DRIVER: 'opensandbox',
        OPEN_SANDBOX_DOMAIN: '172.16.1.20:8080',
        OPEN_SANDBOX_PROTOCOL: 'http',
        OPEN_SANDBOX_API_KEY: 'test-key',
        OPEN_SANDBOX_IMAGE: 'example.test/sandbox:v1',
        OPEN_SANDBOX_REQUEST_TIMEOUT_SECONDS: 12,
        OPEN_SANDBOX_READY_TIMEOUT_SECONDS: 45,
        OPEN_SANDBOX_USE_SERVER_PROXY: true,
      }),
      new FakeSandboxRuntime(),
    )

    expect(runtime).toBeInstanceOf(OpenSandboxRuntime)
    await (runtime as OpenSandboxRuntime).onModuleDestroy()
  })
})
