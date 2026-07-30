import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'

import { AgentMcpClientError, AgentMcpSdkClient } from './agent-mcp.client'
import { AgentMcpPreferenceRepository } from './agent-mcp-preference.repository'
import {
  agentMcpToolName,
  EmptyAgentMcpRegistry,
  PlatformAgentMcpRegistry,
  sanitizeMcpInputSchema,
} from './agent-mcp.registry'

describe('EmptyAgentMcpRegistry', () => {
  it('returns no servers and performs no discovery', async () => {
    await expect(new EmptyAgentMcpRegistry().listServers('user-1')).resolves.toEqual([])
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

  it('resolves its runtime dependencies through Nest without decorator metadata inference', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConfigService,
        AgentMcpSdkClient,
        {
          provide: AgentMcpPreferenceRepository,
          useValue: { listForUser: async () => new Map(), setEnabled: async () => undefined },
        },
        PlatformAgentMcpRegistry,
      ],
    }).compile()

    await expect(moduleRef.get(PlatformAgentMcpRegistry).listServers('user-1')).resolves.toEqual([])
    await moduleRef.close()
  })

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

    await expect(registry.listStatuses('user-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'docs',
        status: 'error',
        errorCode: 'MCP_TIMEOUT',
        registeredToolCount: 0,
      }),
    ])
    expect(JSON.stringify(await registry.listStatuses('user-1'))).not.toContain(server.url)
  })

  it('adds a query credential server-side without exposing it in the plugin status', async () => {
    const client = {
      discover: jest.fn(async () => ({ serverName: 'Amap', serverVersion: '1.0.0', tools: [] })),
    } as unknown as AgentMcpSdkClient
    const registry = createRegistry(
      {
        ...server,
        id: 'amap',
        auth: { type: 'query' as const, parameter: 'key', tokenEnv: 'AMAP_MCP_API_KEY' },
      },
      client,
      new Map([['amap', true]]),
      undefined,
      { AMAP_MCP_API_KEY: 'test-map-key' },
    )

    const [status] = await registry.listStatuses('user-1')

    expect(status).toMatchObject({ id: 'amap', status: 'ready' })
    expect(client.discover).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://mcp.example.test/mcp?key=test-map-key' }),
    )
    expect(JSON.stringify(status)).not.toContain('test-map-key')
  })

  it('does not discover or expose a server disabled by the current user', async () => {
    const client = {
      discover: jest.fn(),
    } as unknown as AgentMcpSdkClient
    const registry = createRegistry(server, client, new Map([['docs', false]]))

    await expect(registry.listStatuses('user-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'docs',
        enabled: false,
        status: 'disabled',
        discoveredToolCount: 0,
        registeredToolCount: 0,
      }),
    ])
    await expect(
      registry.resolveTools({
        runId: 'run-1',
        userId: 'user-1',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([])
    await expect(registry.listServers('user-1')).resolves.toEqual([])
    expect(client.discover).not.toHaveBeenCalled()
  })

  it('persists a user switch and rejects unknown platform server IDs', async () => {
    const setEnabled = jest.fn(async () => undefined)
    const preferences = {
      listForUser: async () => new Map<string, boolean>(),
      setEnabled,
    } as unknown as AgentMcpPreferenceRepository
    const client = {
      discover: jest.fn(async () => ({
        serverName: 'remote-name',
        serverVersion: '1.2.3',
        tools: [],
      })),
    } as unknown as AgentMcpSdkClient
    const registry = createRegistry(server, client, new Map(), preferences)

    await expect(registry.setServerEnabled('user-1', 'docs', false)).resolves.toMatchObject({
      id: 'docs',
      enabled: false,
      status: 'disabled',
    })
    expect(setEnabled).toHaveBeenCalledWith('user-1', 'docs', false)
    await expect(registry.setServerEnabled('user-1', 'custom', true)).rejects.toMatchObject({
      serverId: 'custom',
    })
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

function createRegistry(
  server: object,
  client: AgentMcpSdkClient,
  userPreferences?: ReadonlyMap<string, boolean>,
  preferenceRepository?: AgentMcpPreferenceRepository,
  environment: Record<string, unknown> = {},
): PlatformAgentMcpRegistry {
  const serverId = 'id' in server && typeof server.id === 'string' ? server.id : ''
  const preferences = userPreferences ?? new Map([[serverId, true]])
  const registry = new PlatformAgentMcpRegistry(
    new ConfigService({
      AGENT_MCP_SERVERS_JSON: [server],
      AGENT_MCP_DISCOVERY_TIMEOUT_MS: 1_000,
      AGENT_MCP_CALL_TIMEOUT_MS: 1_000,
      AGENT_MCP_MAX_TOOLS_PER_SERVER: 10,
      AGENT_MCP_MAX_RESPONSE_BYTES: 100_000,
      AGENT_MCP_MAX_OUTPUT_CHARS: 10_000,
      ...environment,
    }),
    client,
    preferenceRepository ??
      ({
        listForUser: async () => preferences,
        setEnabled: async () => undefined,
      } as unknown as AgentMcpPreferenceRepository),
  )
  ;(registry as unknown as { servers: readonly object[] }).servers = [server]
  return registry
}
