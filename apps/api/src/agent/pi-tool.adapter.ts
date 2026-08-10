import type { TSchema } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult as PiAgentToolResult } from '@earendil-works/pi-agent-core'

import type { AgentToolDefinition } from './tools/agent-tool'
import { AgentToolExecutionError } from './tools/agent-tool'
import type { AgentToolRegistry } from './tools/agent-tool.registry'

export interface PiToolDetails {
  summary: string
  audit?: Record<string, unknown>
  code?: string
}

export interface PiToolExecutionScope {
  runId: string
  userId: string
}

/**
 * 把平台中立的 `AgentToolDefinition` 转换为 Pi harness 使用的 `AgentTool`。
 *
 * - JSON Schema 参数作为 Pi 工具 schema（Pi 与 registry 双层校验）。
 * - 实际执行走 registry.execute：未知工具拒绝；无效参数返回失败结果、不触发出站。
 * - 成功结果映射为 Pi tool result（text content + details 携带 summary/audit）。
 * - 失败按 Pi 约定抛错，并把规范化错误码写入可读文本；Pi 会把自定义错误 details
 *   收敛为空对象，Projector 再从该文本恢复错误码用于审计。
 */
export function toPiAgentTool(
  definition: AgentToolDefinition,
  registry: AgentToolRegistry,
  scope?: PiToolExecutionScope,
): AgentTool {
  return {
    name: definition.name,
    description: definition.description,
    label: definition.label,
    parameters: definition.parameters as unknown as TSchema,
    ...(definition.prepareArguments === undefined
      ? {}
      : { prepareArguments: definition.prepareArguments }),
    ...(definition.executionMode === undefined ? {} : { executionMode: definition.executionMode }),
    execute: async (
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<PiAgentToolResult<PiToolDetails>> => {
      const result = await registry.execute(definition.name, params, {
        toolCallId,
        signal: signal ?? new AbortController().signal,
        ...(scope === undefined ? {} : scope),
      })
      if (result.isError) {
        const code = typeof result.audit?.code === 'string' ? result.audit.code : 'AGENT_TOOL_ERROR'
        throw new AgentToolExecutionError({
          code,
          message: `[${code}] ${result.content}`,
          summary: result.summary,
          ...(result.audit === undefined ? {} : { audit: result.audit }),
        })
      }
      return {
        content: [{ type: 'text', text: result.content }],
        details: {
          summary: result.summary,
          ...(result.audit === undefined ? {} : { audit: result.audit }),
        },
      }
    },
  }
}
