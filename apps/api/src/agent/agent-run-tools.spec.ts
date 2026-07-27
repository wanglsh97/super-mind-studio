import type { AgentMcpRegistry } from './mcp/agent-mcp.registry'
import type { AgentToolDefinition } from './tools/agent-tool'
import { AgentToolRegistry } from './tools/agent-tool.registry'
import { createAgentRunToolRegistry } from './agent-run-tools'

const tool = (name: string): AgentToolDefinition => ({
  name,
  label: name,
  description: name,
  riskLevel: 'read',
  approvalPolicy: 'none',
  parameters: { type: 'object' },
  execute: async () => ({ content: '', summary: '', isError: false }),
})

describe('createAgentRunToolRegistry', () => {
  it('resolves MCP once and returns an immutable combined registry', async () => {
    const resolveTools = jest.fn(async () => [tool('mcp__docs__lookup')])
    const mcp: AgentMcpRegistry = {
      listServers: () => [],
      listStatuses: async () => [],
      resolveTools,
    }
    const input = {
      runId: 'run-1',
      userId: 'user-1',
      signal: new AbortController().signal,
    }

    const registry = await createAgentRunToolRegistry(
      new AgentToolRegistry([tool('web_fetch')]),
      mcp,
      input,
    )

    expect(resolveTools).toHaveBeenCalledTimes(1)
    expect(resolveTools).toHaveBeenCalledWith(input)
    expect(registry.list().map((item) => item.name)).toEqual([
      'web_fetch',
      'mcp__docs__lookup',
    ])
  })
})
