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
  it('keeps remote MCP tools out of the run registry', async () => {
    const resolveTools = jest.fn(async () => [tool('mcp__docs__lookup')])
    const mcp: AgentMcpRegistry = {
      listServers: async () => [],
      describeServers: () => [],
      listStatuses: async () => [],
      setServerEnabled: async () => {
        throw new Error('not used')
      },
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

    expect(resolveTools).not.toHaveBeenCalled()
    expect(registry.list().map((item) => item.name)).toEqual(['web_fetch'])
  })
})
