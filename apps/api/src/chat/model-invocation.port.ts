import type { AgentThinkingEffort, ChatFinishReason, TextModelAlias } from '@supermind/sdk'

import type {
  ChatAdapterMessage,
  ChatAdapterToolCall,
  ChatAdapterToolChoice,
  ChatAdapterToolDefinition,
  ChatAdapterUsage,
} from '../adapters/chat-adapter'

/**
 * Provider-neutral 内部模型调用端口。
 *
 * 普通 Chat 编排与 Agent Pi harness 都通过该端口发起模型调用：端口负责模型解析、
 * Adapter 选择、首事件前 failover 与被动健康，并把厂商响应统一为
 * text / reasoning / tool-call / usage / finish 事件；tool-result 作为请求消息输入。
 * 端口不向调用方暴露任何厂商响应类型或 Pi 运行时对象。
 */
export interface ModelInvocationRequest {
  requestId: string
  /** 模型目录 ID 或稳定别名，由端口解析为 provider + 上游模型。 */
  modelId: string
  messages: readonly ChatAdapterMessage[]
  tools?: readonly ChatAdapterToolDefinition[]
  toolChoice?: ChatAdapterToolChoice
  temperature?: number
  topP?: number
  maxTokens?: number
  /** Provider-neutral 的 run 级思考强度；省略时按 `balanced` 处理。 */
  thinkingEffort?: AgentThinkingEffort
  signal: AbortSignal
  /** 是否允许在首个内容事件前做一次 failover，默认 true。 */
  allowFailover?: boolean
}

export type ModelStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool-call'; toolCall: ChatAdapterToolCall }
  | {
      type: 'usage'
      usage: ChatAdapterUsage
      provider?: TextModelAlias
      resolvedModel?: string
    }
  | {
      type: 'finish'
      finishReason: ChatFinishReason
      provider: TextModelAlias
      resolvedModel: string
      providerRequestId?: string
      failover?: { from: string; to: string; reason: string }
    }

export interface ModelInvocationPort {
  /**
   * 发起一次模型调用并返回统一事件流。
   *
   * 契约：在首个内容事件（text/reasoning/tool-call）发出前，若发生可重试的 timeout/5xx，
   * 最多 failover 一次；首个内容事件后禁止切换。错误以 `ChatAdapterError` 抛出，由调用方
   * 归一化并终结生命周期。
   */
  invoke(request: ModelInvocationRequest): AsyncIterable<ModelStreamEvent>
}

export const MODEL_INVOCATION_PORT = Symbol('MODEL_INVOCATION_PORT')
