import { ConfigService } from '@nestjs/config'

import { startMcpFixtureServer } from '../../../scripts/mcp-fixture'
import { AgentToolRegistry } from '../tools/agent-tool.registry'
import { AgentMcpSdkClient } from './agent-mcp.client'
import { PlatformAgentMcpRegistry } from './agent-mcp.registry'

describe('official MCP SDK Streamable HTTP contract', () => {
  it('initializes, discovers, allowlists and invokes a namespaced fixture tool', async () => {
    const fixture = await startMcpFixtureServer()
    try {
      const client = new AgentMcpSdkClient()
      const discovery = await client.discover({
        url: fixture.url,
        signal: new AbortController().signal,
        timeoutMs: 5_000,
        maxResponseBytes: 100_000,
        maxTools: 10,
      })
      expect(discovery).toMatchObject({
        serverName: 'supermind-mcp-fixture',
        serverVersion: '1.0.0',
      })
      expect(discovery.tools.map((tool) => tool.name)).toEqual(['echo', 'hidden'])

      const registry = new PlatformAgentMcpRegistry(
        new ConfigService({
          AGENT_MCP_SERVERS_JSON: [
            {
              id: 'fixture',
              name: 'Fixture',
              description: 'Local fixture',
              url: fixture.url,
              auth: { type: 'none' },
              tools: [{ name: 'echo', description: 'Echo local text', riskLevel: 'read' }],
            },
          ],
          AGENT_MCP_DISCOVERY_TIMEOUT_MS: 5_000,
          AGENT_MCP_CALL_TIMEOUT_MS: 5_000,
          AGENT_MCP_MAX_TOOLS_PER_SERVER: 10,
          AGENT_MCP_MAX_RESPONSE_BYTES: 100_000,
          AGENT_MCP_MAX_OUTPUT_CHARS: 10_000,
        }),
        client,
      )
      const tools = await registry.resolveTools({
        runId: 'run-fixture',
        userId: 'user-fixture',
        signal: new AbortController().signal,
      })
      const runRegistry = new AgentToolRegistry(tools)

      expect(runRegistry.list().map((tool) => tool.name)).toEqual(['mcp__fixture__echo'])
      const result = await runRegistry.execute(
        'mcp__fixture__echo',
        { text: 'hello' },
        {
          toolCallId: 'call-fixture',
          runId: 'run-fixture',
          userId: 'user-fixture',
          signal: new AbortController().signal,
        },
      )
      expect(result).toMatchObject({
        isError: false,
        audit: {
          serverId: 'fixture',
          remoteToolName: 'echo',
          contentBlockCount: 1,
          truncated: false,
        },
      })
      expect(result.content).toContain('fixture:hello')
      expect(fixture.calls).toEqual([{ toolName: 'echo', arguments: { text: 'hello' } }])
    } finally {
      await fixture.close()
    }
  })

  it('sends a server-only bearer token without returning it in discovery data', async () => {
    const token = 'fixture-secret-token'
    const fixture = await startMcpFixtureServer({ bearerToken: token })
    try {
      const discovery = await new AgentMcpSdkClient().discover({
        url: fixture.url,
        bearerToken: token,
        signal: new AbortController().signal,
        timeoutMs: 5_000,
        maxResponseBytes: 100_000,
        maxTools: 10,
      })
      expect(JSON.stringify(discovery)).not.toContain(token)
      expect(discovery.tools).toHaveLength(2)
    } finally {
      await fixture.close()
    }
  })
})
