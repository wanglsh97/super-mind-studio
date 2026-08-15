import { AgentToolRegistry } from './tools/agent-tool.registry';

/**
 * MCP 远端工具按需经 discover_mcp_tools/call_mcp_tool 访问；Run 不再携带全量远端定义。
 */
export async function createAgentRunToolRegistry(
  builtIns: AgentToolRegistry,
  _mcp: unknown,
  input: {
    mode?: 'website' | 'document' | 'image' | 'video';
    runId?: string;
    userId?: string;
    signal?: AbortSignal;
  },
): Promise<AgentToolRegistry> {
  void _mcp;
  return new AgentToolRegistry(
    builtIns.list().filter((tool) => {
      if (tool.name === 'create_website') return input.mode === 'website';
      if (tool.name === 'generate_image') return input.mode === 'image';
      if (tool.name === 'generate_video') return input.mode === 'video';
      return true;
    }),
  );
}
