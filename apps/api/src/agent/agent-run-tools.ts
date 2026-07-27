import type { AgentMcpRegistry, ResolveAgentMcpToolsInput } from './mcp/agent-mcp.registry'
import { AgentToolRegistry } from './tools/agent-tool.registry'

/**
 * Resolves MCP exactly once and freezes the built-in + remote definitions in one run-owned registry.
 */
export async function createAgentRunToolRegistry(
  builtIns: AgentToolRegistry,
  mcp: AgentMcpRegistry,
  input: ResolveAgentMcpToolsInput,
): Promise<AgentToolRegistry> {
  const mcpTools = await mcp.resolveTools(input)
  return new AgentToolRegistry([...builtIns.list(), ...mcpTools])
}
