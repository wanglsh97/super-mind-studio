import type { AgentMcpServerStatus } from '@supermind/sdk'

/** Replaces the status returned by the user-facing /mcp route. */
export function replaceMcpServerStatus(
  servers: readonly AgentMcpServerStatus[],
  updated: AgentMcpServerStatus,
): AgentMcpServerStatus[] {
  return servers.map((server) => (server.id === updated.id ? updated : server))
}

export function mcpConnectionLabel(server: AgentMcpServerStatus): string {
  if (!server.enabled || server.status === 'disabled') return '已停用'
  if (server.status === 'ready') return '连接正常'
  if (server.status === 'error') return '连接异常'
  return '等待连接'
}
