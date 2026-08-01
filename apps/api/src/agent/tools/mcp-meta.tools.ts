import type { AgentToolDefinition } from './agent-tool'
import { McpToolDispatcher } from '../mcp/mcp-dispatcher'

export function createDiscoverMcpToolsTool(dispatcher: McpToolDispatcher): AgentToolDefinition {
  return {
    name: 'discover_mcp_tools', label: '发现 MCP 工具', riskLevel: 'read', approvalPolicy: 'none',
    description: '发现已启用 MCP 插件中与当前任务相关的工具，并返回 input schema 与调用句柄。',
    parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', minLength: 1, maxLength: 500 }, serverIds: { type: 'array' } } },
    execute: async (args, context) => ({ content: JSON.stringify({ matches: await dispatcher.discover({ query: String(args.query), ...(Array.isArray(args.serverIds) ? { serverIds: args.serverIds.filter((id): id is string => typeof id === 'string') } : {}), context }) }), summary: 'MCP 工具发现完成', isError: false }),
  }
}

export function createCallMcpTool(dispatcher: McpToolDispatcher): AgentToolDefinition {
  return {
    name: 'call_mcp_tool', label: '调用 MCP 工具', riskLevel: 'read', approvalPolicy: 'none',
    description: '使用 discover_mcp_tools 返回的 toolHandle，按已返回的 input schema 调用 MCP 工具。',
    parameters: { type: 'object', additionalProperties: false, required: ['toolHandle', 'arguments'], properties: { toolHandle: { type: 'string', minLength: 1 }, arguments: { type: 'object' } } },
    execute: async (args, context) => dispatcher.call(String(args.toolHandle), args.arguments as Record<string, unknown>, context),
  }
}
