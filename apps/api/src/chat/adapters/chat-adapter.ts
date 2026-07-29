import type { AgentThinkingEffort, ChatFinishReason, TextModelAlias } from '@supermind/sdk'

import type { ChatAdapterId } from '../chat.constants'

/** 平台中立的工具调用块，供助手回放上一轮 tool call 与本轮新 tool call 使用。 */
export interface ChatAdapterToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/**
 * 适配器消息（普通 Chat 与 Agent tool loop 共用）。
 *
 * `ChatMessage`（system/user/assistant + content）结构上兼容本类型；Agent 额外使用
 * `tool` 角色回传工具结果，以及在 assistant 消息上携带 `toolCalls` 回放。
 */
export interface ChatAdapterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /**
   * 历史 assistant reasoning 的 provider-neutral 表达。支持原生回灌的 Adapter 应映射到
   * 厂商 reasoning 字段；不支持时由上下文装配器将其降级为低信任 tagged content。
   */
  reasoningContent?: string
  toolCallId?: string
  toolName?: string
  toolCalls?: readonly ChatAdapterToolCall[]
}

/** JSON Schema 工具定义（provider-neutral）。 */
export interface ChatAdapterToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type ChatAdapterToolChoice = 'auto' | 'required' | 'none'

export interface ChatAdapterRequest {
  requestId: string
  modelAlias: TextModelAlias
  resolvedModel: string
  messages: readonly ChatAdapterMessage[]
  signal: AbortSignal
  temperature?: number
  topP?: number
  maxTokens?: number
  thinkingEffort?: AgentThinkingEffort
  tools?: readonly ChatAdapterToolDefinition[]
  toolChoice?: ChatAdapterToolChoice
}

export interface ChatAdapterUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  /** Provider-reported cached portion of input tokens; null/undefined means unavailable. */
  cachedInputTokens?: number | null
  /** Provider-reported reasoning portion of output tokens; null/undefined means unavailable. */
  reasoningTokens?: number | null
  usageUnknown: boolean
}

export type ChatAdapterEvent =
  | {
      type: 'delta'
      content: string
      providerRequestId?: string
    }
  | {
      type: 'reasoning'
      content: string
      providerRequestId?: string
    }
  | {
      type: 'tool-call'
      toolCall: ChatAdapterToolCall
      providerRequestId?: string
    }
  | {
      type: 'usage'
      usage: ChatAdapterUsage
      providerRequestId?: string
    }
  | {
      type: 'finish'
      finishReason: ChatFinishReason
      providerRequestId?: string
    }

export interface ChatAdapter {
  readonly id: ChatAdapterId
  readonly resolvedModel: string
  stream(request: ChatAdapterRequest): AsyncIterable<ChatAdapterEvent>
}

export interface ChatAdapterErrorOptions {
  code: string
  retryable: boolean
  statusCode?: number
  providerRequestId?: string
  cause?: unknown
}

export class ChatAdapterError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly statusCode: number | undefined
  readonly providerRequestId: string | undefined

  constructor(message: string, options: ChatAdapterErrorOptions) {
    super(message, { cause: options.cause })
    this.name = 'ChatAdapterError'
    this.code = options.code
    this.retryable = options.retryable
    this.statusCode = options.statusCode
    this.providerRequestId = options.providerRequestId
  }
}
