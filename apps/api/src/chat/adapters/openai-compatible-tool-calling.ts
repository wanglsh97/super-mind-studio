import type { ChatFinishReason } from '@supermind/sdk'

import type {
  ChatAdapterRequest,
  ChatAdapterToolCall,
  ChatAdapterToolDefinition,
} from './chat-adapter'
import { ChatAdapterError } from './chat-adapter'

export type OpenAICompatibleProtocolErrorFactory = (
  message: string,
  cause?: unknown,
) => ChatAdapterError

interface OpenAICompatibleToolCallDelta {
  index: number
  id?: string
  name?: string
  argumentsDelta?: string
}

interface PendingOpenAICompatibleToolCall {
  id?: string
  name?: string
  argumentsText: string
}

/** 将平台中立工具定义映射为 OpenAI-compatible Chat Completions 请求字段。 */
export function openAICompatibleToolRequestFields(
  request: Pick<ChatAdapterRequest, 'tools' | 'toolChoice'>,
): Record<string, unknown> {
  if (!request.tools?.length) return {}

  return {
    tools: request.tools.map(toOpenAICompatibleToolDefinition),
    tool_choice: request.toolChoice ?? 'auto',
  }
}

/**
 * 聚合 OpenAI-compatible 流式 `delta.tool_calls` 分片。
 *
 * Provider Adapter 仍负责识别自己的 chunk、usage、reasoning 与错误字段；本类只统一
 * tool-call 分片校验、按 index 拼接、JSON 参数解析和 finish_reason 一致性检查。
 */
export class OpenAICompatibleToolCallAssembler {
  private readonly pending = new Map<number, PendingOpenAICompatibleToolCall>()
  private emitted = false

  constructor(
    private readonly providerName: string,
    private readonly protocolError: OpenAICompatibleProtocolErrorFactory,
  ) {}

  addDeltas(value: unknown): void {
    for (const delta of this.parseDeltas(value)) this.merge(delta)
  }

  finish(reason: ChatFinishReason): ChatAdapterToolCall[] {
    if (reason !== 'tool_calls') {
      if (this.pending.size > 0) {
        throw this.protocolError(
          `${this.providerName} emitted tool-call fragments but finished with ${reason}`,
        )
      }
      return []
    }

    const calls = this.finalize()
    this.emitted = true
    return calls
  }

  assertStreamDone(reason: ChatFinishReason): void {
    if (reason === 'tool_calls' && !this.emitted) {
      throw this.protocolError(
        `${this.providerName} finished with tool_calls but emitted no valid tool call`,
      )
    }
  }

  private parseDeltas(value: unknown): OpenAICompatibleToolCallDelta[] {
    if (!Array.isArray(value)) {
      throw this.protocolError(`${this.providerName} tool_calls must be an array`)
    }

    return value.map((item) => {
      const call = record(item, `${this.providerName} tool call delta`, this.protocolError)
      if (!Number.isInteger(call.index) || (call.index as number) < 0) {
        throw this.protocolError(
          `${this.providerName} tool call index must be a non-negative integer`,
        )
      }
      if (call.id !== undefined && typeof call.id !== 'string') {
        throw this.protocolError(`${this.providerName} tool call id must be text`)
      }

      const parsed: OpenAICompatibleToolCallDelta = { index: call.index as number }
      if (typeof call.id === 'string' && call.id) parsed.id = call.id

      if (call.function !== undefined && call.function !== null) {
        const fn = record(
          call.function,
          `${this.providerName} tool call function`,
          this.protocolError,
        )
        if (fn.name !== undefined && typeof fn.name !== 'string') {
          throw this.protocolError(`${this.providerName} tool call function name must be text`)
        }
        if (fn.arguments !== undefined && typeof fn.arguments !== 'string') {
          throw this.protocolError(`${this.providerName} tool call arguments must be text`)
        }
        if (typeof fn.name === 'string' && fn.name) parsed.name = fn.name
        if (typeof fn.arguments === 'string') parsed.argumentsDelta = fn.arguments
      }

      return parsed
    })
  }

  private merge(delta: OpenAICompatibleToolCallDelta): void {
    const current = this.pending.get(delta.index) ?? { argumentsText: '' }
    if (delta.id !== undefined) {
      if (current.id !== undefined && current.id !== delta.id) {
        throw this.protocolError(
          `${this.providerName} changed tool call id at index ${delta.index}`,
        )
      }
      current.id = delta.id
    }
    if (delta.name !== undefined) {
      if (current.name !== undefined && current.name !== delta.name) {
        throw this.protocolError(`${this.providerName} changed tool name at index ${delta.index}`)
      }
      current.name = delta.name
    }
    if (delta.argumentsDelta !== undefined) current.argumentsText += delta.argumentsDelta
    this.pending.set(delta.index, current)
  }

  private finalize(): ChatAdapterToolCall[] {
    if (this.pending.size === 0) {
      throw this.protocolError(
        `${this.providerName} finished with tool_calls but supplied no tool-call fragments`,
      )
    }

    return [...this.pending.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => {
        if (!call.id) {
          throw this.protocolError(`${this.providerName} tool call ${index} is missing an id`)
        }
        if (!call.name) {
          throw this.protocolError(
            `${this.providerName} tool call ${index} is missing a function name`,
          )
        }

        let args: unknown
        try {
          args = JSON.parse(call.argumentsText || '{}')
        } catch (error) {
          throw this.protocolError(
            `${this.providerName} tool call ${index} contains invalid JSON arguments`,
            error,
          )
        }
        if (typeof args !== 'object' || args === null || Array.isArray(args)) {
          throw this.protocolError(
            `${this.providerName} tool call ${index} arguments must decode to an object`,
          )
        }

        return {
          id: call.id,
          name: call.name,
          arguments: args as Record<string, unknown>,
        }
      })
  }
}

function toOpenAICompatibleToolDefinition(
  tool: ChatAdapterToolDefinition,
): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

function record(
  value: unknown,
  label: string,
  protocolError: OpenAICompatibleProtocolErrorFactory,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw protocolError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}
