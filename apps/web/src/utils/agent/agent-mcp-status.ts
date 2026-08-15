import type { AgentMcpServerStatus } from '@supermind/sdk';

export interface AgentMcpStatusSummary {
  serverCount: number;
  readyCount: number;
  errorCount: number;
  registeredToolCount: number;
}

export function summarizeAgentMcpStatuses(
  statuses: readonly AgentMcpServerStatus[],
): AgentMcpStatusSummary {
  return statuses.reduce<AgentMcpStatusSummary>(
    (summary, status) => ({
      serverCount: summary.serverCount + 1,
      readyCount: summary.readyCount + (status.status === 'ready' ? 1 : 0),
      errorCount: summary.errorCount + (status.status === 'error' ? 1 : 0),
      registeredToolCount: summary.registeredToolCount + status.registeredToolCount,
    }),
    { serverCount: 0, readyCount: 0, errorCount: 0, registeredToolCount: 0 },
  );
}

export function parseNamespacedMcpToolName(
  toolName: string,
): { serverId: string; remoteToolName: string } | null {
  const match = /^mcp__([a-z0-9-]+)__([A-Za-z0-9_-]+)$/.exec(toolName);
  if (!match?.[1] || !match[2]) return null;
  return { serverId: match[1], remoteToolName: match[2] };
}
