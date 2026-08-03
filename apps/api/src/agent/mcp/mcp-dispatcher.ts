import { randomUUID } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'

import { AGENT_MCP_REGISTRY, type AgentMcpRegistry } from './agent-mcp.registry'
import type { AgentToolContext, AgentToolDefinition, AgentToolResult } from '../tools/agent-tool'
import { TelemetryService } from '../../observability/telemetry.service'

interface DiscoveredTool {
  runId: string
  userId: string
  definition: AgentToolDefinition
  expiresAt: number
}

@Injectable()
export class McpToolDispatcher {
  private readonly handles = new Map<string, DiscoveredTool>()

  constructor(@Inject(AGENT_MCP_REGISTRY) private readonly mcp: AgentMcpRegistry, private readonly telemetry = new TelemetryService()) {}

  async discover(input: { query: string; serverIds?: string[]; context: AgentToolContext }) {
    const { runId, userId } = requiredScope(input.context)
    const span = this.telemetry.startSpan('agent.mcp.discover', { runId, toolName: 'discover_mcp_tools' })
    let tools: readonly AgentToolDefinition[]
    try {
      tools = await this.mcp.resolveTools({ runId, userId, signal: input.context.signal })
      this.telemetry.endSpan(span, 'ok', { runId, toolName: 'discover_mcp_tools', status: 'succeeded' })
    } catch (error) {
      this.telemetry.endSpan(span, 'error', { runId, toolName: 'discover_mcp_tools', status: 'failed', errorCode: 'MCP_DISCOVERY_FAILED' })
      throw error
    }
    const needles = input.query.toLowerCase().split(/\s+/).filter(Boolean)
    return tools
      .filter((tool) => {
        if (input.serverIds?.length && !input.serverIds.includes(serverIdOf(tool.name))) return false
        const source = `${tool.name} ${tool.description}`.toLowerCase()
        return needles.length === 0 || needles.some((needle) => source.includes(needle))
      })
      .slice(0, 8)
      .map((definition) => {
        const toolHandle = randomUUID()
        this.handles.set(toolHandle, { runId, userId, definition, expiresAt: Date.now() + 15 * 60_000 })
        return {
          toolHandle,
          serverId: serverIdOf(definition.name),
          toolName: remoteToolNameOf(definition.name),
          description: truncate(definition.description, 500),
          riskLevel: definition.riskLevel,
          inputSchema: definition.parameters,
        }
      })
  }

  async call(toolHandle: string, args: Record<string, unknown>, context: AgentToolContext): Promise<AgentToolResult> {
    const { runId, userId } = requiredScope(context)
    const discovered = this.handles.get(toolHandle)
    if (!discovered || discovered.expiresAt < Date.now() || discovered.runId !== runId || discovered.userId !== userId) {
      return { content: 'MCP 工具句柄无效、已过期或不属于当前 Run', summary: 'MCP 工具不可用', isError: true, audit: { code: 'MCP_TOOL_HANDLE_INVALID' } }
    }
    const startedAt = performance.now()
    const serverId = serverIdOf(discovered.definition.name)
    const span = this.telemetry.startSpan('agent.mcp.call', { runId, toolName: remoteToolNameOf(discovered.definition.name), mcpServer: serverId })
    let result: AgentToolResult
    try {
      result = await discovered.definition.execute(args, context)
      const attributes = { runId, toolName: remoteToolNameOf(discovered.definition.name), mcpServer: serverId, status: result.isError ? 'failed' as const : 'succeeded' as const, errorCode: auditCode(result) }
      this.telemetry.endSpan(span, result.isError ? 'error' : 'ok', attributes)
      this.telemetry.recordToolInvocation(performance.now() - startedAt, attributes)
    } catch (error) {
      const attributes = { runId, toolName: remoteToolNameOf(discovered.definition.name), mcpServer: serverId, status: 'failed' as const, errorCode: 'MCP_CALL_FAILED' }
      this.telemetry.endSpan(span, 'error', attributes)
      this.telemetry.recordToolInvocation(performance.now() - startedAt, attributes)
      throw error
    }
    return {
      ...result,
      audit: { ...result.audit, serverId, remoteToolName: remoteToolNameOf(discovered.definition.name) },
    }
  }
}

function requiredScope(context: AgentToolContext): { runId: string; userId: string } {
  if (!context.runId || !context.userId) throw new Error('MCP 工具必须在 Agent Run 范围内调用')
  return { runId: context.runId, userId: context.userId }
}

function serverIdOf(name: string): string { return /^mcp__([a-z0-9-]+)__/.exec(name)?.[1] ?? 'unknown' }
function remoteToolNameOf(name: string): string { return name.replace(/^mcp__[a-z0-9-]+__/, '') }
function truncate(value: string, limit: number): string { return Array.from(value).slice(0, limit).join('') }
function auditCode(result: AgentToolResult): string | undefined { return typeof result.audit?.code === 'string' ? result.audit.code : undefined }
