import { ConfigService } from '@nestjs/config'

import { createSandboxRuntime, resolveAgentTools } from './agent.module'
import { AgentExecutionSessionService } from './sandbox/agent-execution-session.service'
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

describe('resolveAgentTools', () => {
  const sessions = {} as AgentExecutionSessionService

  it('registers one provider-neutral web_search tool by default', () => {
    const tools = resolveAgentTools(new ConfigService(), sessions)
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['web_fetch', 'web_search']),
    )
    expect(tools.find((tool) => tool.name === 'web_search')).toMatchObject({
      riskLevel: 'external_send',
      approvalPolicy: 'none',
    })
  })

  it('removes web_search when disabled', () => {
    const tools = resolveAgentTools(
      new ConfigService({ AGENT_WEB_SEARCH_ENABLED: false }),
      sessions,
    )
    expect(tools.map((tool) => tool.name)).toContain('web_fetch')
    expect(tools.map((tool) => tool.name)).not.toContain('web_search')
  })
})
