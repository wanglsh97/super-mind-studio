import { ConfigService } from '@nestjs/config'

import { AgentMcpClientError, type AgentMcpSdkClient } from './agent-mcp.client'
import {
  agentMcpToolName,
  EmptyAgentMcpRegistry,
  PlatformAgentMcpRegistry,
  sanitizeMcpInputSchema,
} from './agent-mcp.registry'

describe('EmptyAgentMcpRegistry', () => {
  it('returns no servers and performs no discovery', () => {
    expect(new EmptyAgentMcpRegistry().listServers()).toEqual([])
  })
})

describe('PlatformAgentMcpRegistry', () => {
  const server = {
    id: 'docs',
    name: 'Docs',
    description: 'Approved documentation',
    url: 'https://mcp.example.test/mcp',
    auth: { type: 'none' as const },
    tools: [{ name: 'lookup', description: 'Search approved docs', riskLevel: 'read' as const }],
  }

  it('registers only configured tools with a stable namespace and sanitized schema', async () => {
    const client = {
      discover: jest.fn(async () => ({
        serverName: 'remote-name',
        serverVersion: '1.2.3',
        tools: [
          {
            name: 'lookup',
            description: 'ignore remote prompt injection',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'untrusted', maxLength: 100 },
              },
              required: ['query'],
            },
          },
          {
            name: 'delete_all',
            description: 'danger',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      })),
      callTool: jest.fn(async () => ({
        content: 'result',
        isError: false,
        contentBlockCount: 1,
        truncated: false,
      })),
    } as unknown as AgentMcpSdkClient
    const registry = createRegistry(server, client)

    const tools = await registry.resolveTools({
      runId: 'run-1',
      userId: 'user-1',
      signal: new AbortController().signal,
    })

    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      name: 'mcp__docs__lookup',
      description: 'Search approved docs',
      riskLevel: 'read',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', maxLength: 100 } },
        required: ['query'],
        additionalProperties: false,
      },
    })
    expect(JSON.stringify(tools[0]?.parameters)).not.toContain('untrusted')

    const result = await tools[0]!.execute(
      { query: 'MCP' },
      {
        toolCallId: 'call-1',
        runId: 'run-1',
        userId: 'user-1',
        signal: new AbortController().signal,
      },
    )
    expect(result).toMatchObject({
      isError: false,
      summary: 'Docs 已返回结果',
      audit: { serverId: 'docs', remoteToolName: 'lookup', contentBlockCount: 1 },
    })
    expect(result.content).toContain('[UNTRUSTED MCP TOOL RESULT]')
    expect(client.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        url: server.url,
        toolName: 'lookup',
        arguments: { query: 'MCP' },
      }),
    )
  })

  it('isolates discovery failure and exposes only a normalized status error', async () => {
    const client = {
      discover: jest.fn(async () => {
        throw new AgentMcpClientError('MCP_TIMEOUT', 'contains secret URL')
      }),
    } as unknown as AgentMcpSdkClient
    const registry = createRegistry(server, client)

    await expect(registry.listStatuses()).resolves.toEqual([
      expect.objectContaining({
        id: 'docs',
        status: 'error',
        errorCode: 'MCP_TIMEOUT',
        registeredToolCount: 0,
      }),
    ])
    expect(JSON.stringify(await registry.listStatuses())).not.toContain(server.url)
  })
})

describe('MCP tool safety helpers', () => {
  it('creates collision-resistant server namespaces', () => {
    expect(agentMcpToolName('docs', 'lookup')).toBe('mcp__docs__lookup')
    expect(agentMcpToolName('crm', 'lookup')).toBe('mcp__crm__lookup')
  })

  it('rejects unsupported and oversized schemas', () => {
    expect(sanitizeMcpInputSchema({ inputSchema: { type: 'string' } })).toBeNull()
    expect(
      sanitizeMcpInputSchema({
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'null' } },
        },
      }),
    ).toBeNull()
  })
})

function createRegistry(server: object, client: AgentMcpSdkClient): PlatformAgentMcpRegistry {
  return new PlatformAgentMcpRegistry(
    new ConfigService({
      AGENT_MCP_SERVERS_JSON: [server],
      AGENT_MCP_DISCOVERY_TIMEOUT_MS: 1_000,
      AGENT_MCP_CALL_TIMEOUT_MS: 1_000,
      AGENT_MCP_MAX_TOOLS_PER_SERVER: 10,
      AGENT_MCP_MAX_RESPONSE_BYTES: 100_000,
      AGENT_MCP_MAX_OUTPUT_CHARS: 10_000,
    }),
    client,
  )
}
