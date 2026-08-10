import { Inject, Injectable } from '@nestjs/common'

import type { AgentToolContext, AgentToolDefinition, AgentToolResult } from './agent-tool'
import { AgentToolExecutionError } from './agent-tool'
import { validateToolArguments } from './tool-args.validation'
import { TelemetryService } from '../../observability/telemetry.service'

export const AGENT_TOOLS = Symbol('AGENT_TOOLS')

export class AgentToolNotRegisteredError extends AgentToolExecutionError {
  constructor(readonly toolName: string) {
    super({
      code: 'AGENT_TOOL_NOT_REGISTERED',
      message: `工具 ${toolName} 未在当前 Agent Run 中注册。请改用已提供的工具。`,
      summary: '工具不可用',
      retryable: false,
      audit: { toolName },
    })
    this.name = 'AgentToolNotRegisteredError'
  }
}

export class DuplicateAgentToolError extends Error {
  constructor(readonly toolName: string) {
    super(`Agent tool "${toolName}" is registered more than once`)
    this.name = 'DuplicateAgentToolError'
  }
}

export class UnsupportedAgentToolApprovalError extends Error {
  constructor(readonly toolName: string) {
    super(`Agent tool "${toolName}" requires approval, but V1 has no approval flow`)
    this.name = 'UnsupportedAgentToolApprovalError'
  }
}

/**
 * 服务端内存工具 registry（allowlist）。
 *
 * Agent runtime 只解析已注册工具；模型给出的未注册工具名一律拒绝，不执行任意代码。
 * 执行前按工具 JSON Schema 校验参数；无效参数不调用工具 execute（无出站请求）。
 */
@Injectable()
export class AgentToolRegistry {
  private readonly tools: ReadonlyMap<string, AgentToolDefinition>

  constructor(
    @Inject(AGENT_TOOLS) tools: readonly AgentToolDefinition[],
    @Inject(TelemetryService) private readonly telemetry: TelemetryService = new TelemetryService(),
  ) {
    const byName = new Map<string, AgentToolDefinition>()
    for (const tool of tools) {
      if (tool.approvalPolicy === 'explicit') {
        throw new UnsupportedAgentToolApprovalError(tool.name)
      }
      if (byName.has(tool.name)) throw new DuplicateAgentToolError(tool.name)
      byName.set(tool.name, tool)
    }
    this.tools = byName
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  get(name: string): AgentToolDefinition {
    const tool = this.tools.get(name)
    if (!tool) throw new AgentToolNotRegisteredError(name)
    return tool
  }

  list(): readonly AgentToolDefinition[] {
    return [...this.tools.values()]
  }

  /**
   * 解析工具、校验参数并执行。所有工具失败均抛出 AgentToolExecutionError；无效参数不会调用 execute。
   */
  async execute(
    name: string,
    rawArgs: unknown,
    context: AgentToolContext,
  ): Promise<AgentToolResult> {
    const tool = this.get(name)
    if (context.signal.aborted) {
      throw new AgentToolExecutionError({
        code: 'AGENT_TOOL_ABORTED',
        message: '工具执行已取消',
        summary: '工具已取消',
      })
    }

    const validation = validateToolArguments(tool.parameters, rawArgs)
    if (!validation.ok) {
      throw new AgentToolExecutionError({
        code: validation.code,
        message: `${validation.message}。请根据参数 schema 修正后重试。`,
        summary: '工具参数无效',
        retryable: true,
        audit: { code: validation.code, issues: validation.issues },
      })
    }

    const startedAt = performance.now()
    const span = this.startToolSpan({
      runId: context.runId,
      toolName: tool.name,
    })
    try {
      const result = await tool.execute(validation.args, context)
      if (result.isError) {
        const code = auditCode(result) ?? 'AGENT_TOOL_FAILED'
        throw new AgentToolExecutionError({
          code,
          message: result.content,
          summary: result.summary,
          retryable: result.audit?.retryable === true,
          ...(result.audit === undefined ? {} : { audit: result.audit }),
        })
      }
      const attributes = {
        runId: context.runId,
        toolName: tool.name,
        status: result.isError ? ('failed' as const) : ('succeeded' as const),
        errorCode: auditCode(result),
      }
      this.finishToolTelemetry(span, result.isError ? 'error' : 'ok', startedAt, attributes)
      return result
    } catch (error) {
      const attributes = {
        runId: context.runId,
        toolName: tool.name,
        status: context.signal.aborted ? ('cancelled' as const) : ('failed' as const),
        errorCode: error instanceof AgentToolExecutionError ? error.code : 'AGENT_TOOL_FAILED',
      }
      this.finishToolTelemetry(span, 'error', startedAt, attributes)
      if (error instanceof AgentToolExecutionError) throw error
      throw new AgentToolExecutionError({
        code: context.signal.aborted ? 'AGENT_TOOL_ABORTED' : 'AGENT_TOOL_FAILED',
        message:
          error instanceof Error && error.message
            ? error.message
            : '工具执行失败，请检查工具输入和执行环境后重试。',
        summary: context.signal.aborted ? '工具已取消' : '工具执行失败',
        retryable: !context.signal.aborted,
        audit: { code: context.signal.aborted ? 'AGENT_TOOL_ABORTED' : 'AGENT_TOOL_FAILED' },
        cause: error,
      })
    }
  }

  private startToolSpan(attributes: Parameters<TelemetryService['startSpan']>[1]) {
    try {
      return this.telemetry.startSpan('agent.tool.invoke', attributes)
    } catch {
      return undefined
    }
  }

  private finishToolTelemetry(
    span: ReturnType<TelemetryService['startSpan']> | undefined,
    status: 'ok' | 'error',
    startedAt: number,
    attributes: Parameters<TelemetryService['recordToolInvocation']>[1],
  ): void {
    if (span) {
      try {
        this.telemetry.endSpan(span, status, attributes)
      } catch {
        // Telemetry is best effort and must never replace a tool result or error.
      }
    }
    try {
      this.telemetry.recordToolInvocation(performance.now() - startedAt, attributes)
    } catch {
      // Telemetry is best effort and must never replace a tool result or error.
    }
  }
}

function auditCode(result: AgentToolResult): string | undefined {
  return typeof result.audit?.code === 'string' ? result.audit.code : undefined
}
