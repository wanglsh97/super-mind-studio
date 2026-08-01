import type { AgentMcpRegistry } from './agent-mcp.registry'
import { McpToolDispatcher } from './mcp-dispatcher'

const context = (runId = 'run-1', userId = 'user-1') => ({
  toolCallId: 'call-1', runId, userId, signal: new AbortController().signal,
})

describe('McpToolDispatcher', () => {
  const execute = jest.fn(async () => ({ content: 'weather', summary: 'ok', isError: false }))
  const mcp: AgentMcpRegistry = {
    listServers: async () => [], describeServers: () => [], listStatuses: async () => [],
    setServerEnabled: async () => { throw new Error('unused') },
    resolveTools: async () => [{ name: 'mcp__maps__weather', label: 'Weather', description: 'Get weather', riskLevel: 'read', approvalPolicy: 'none', parameters: { type: 'object' }, execute }],
  }

  beforeEach(() => execute.mockClear())

  it('returns run-scoped handles and audits the real remote tool', async () => {
    const dispatcher = new McpToolDispatcher(mcp)
    const [match] = await dispatcher.discover({ query: 'weather', context: context() })
    expect(match).toMatchObject({ serverId: 'maps', toolName: 'weather', inputSchema: { type: 'object' } })
    const result = await dispatcher.call(match!.toolHandle, { city: 'Beijing' }, context())
    expect(execute).toHaveBeenCalledWith({ city: 'Beijing' }, expect.any(Object))
    expect(result.audit).toMatchObject({ serverId: 'maps', remoteToolName: 'weather' })
  })

  it('rejects handles from another run', async () => {
    const dispatcher = new McpToolDispatcher(mcp)
    const [match] = await dispatcher.discover({ query: 'weather', context: context() })
    await expect(dispatcher.call(match!.toolHandle, {}, context('run-2'))).resolves.toMatchObject({
      isError: true, audit: { code: 'MCP_TOOL_HANDLE_INVALID' },
    })
  })
})
