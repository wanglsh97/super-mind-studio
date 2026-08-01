import { AgentToolRegistry } from './tools/agent-tool.registry'

/**
 * MCP 远端工具按需经 discover_mcp_tools/call_mcp_tool 访问；Run 不再携带全量远端定义。
 */
export async function createAgentRunToolRegistry(
  builtIns: AgentToolRegistry,
  _mcp: unknown,
  _input: unknown,
): Promise<AgentToolRegistry> {
  void _mcp
  void _input
  return new AgentToolRegistry(builtIns.list())
}
