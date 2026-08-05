import { AgentToolRegistry } from './tools/agent-tool.registry'

/**
 * MCP 远端工具按需经 discover_mcp_tools/call_mcp_tool 访问；Run 不再携带全量远端定义。
 */
export async function createAgentRunToolRegistry(
  builtIns: AgentToolRegistry,
  _mcp: unknown,
  input: { mode?: 'website'; runId?: string; userId?: string; signal?: AbortSignal },
): Promise<AgentToolRegistry> {
  void _mcp
  return new AgentToolRegistry(
    builtIns.list().filter((tool) => input.mode === 'website' || tool.name !== 'create_website'),
  )
}
