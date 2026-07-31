import type {
  ChatAdapterMessage,
  ChatAdapterToolDefinition,
} from '../../chat/adapters/chat-adapter'

export interface AgentTokenEstimate {
  tokens: number
  estimated: boolean
}

export type ExactTokenCounter = (text: string) => number

/**
 * Agent 上下文 Token 估算端口。
 *
 * Provider tokenizer 可用时注入精确 counter；默认按 UTF-8 每两个字节一个 token 做保守估算，
 * 对英文和中文都倾向提前压缩，并为消息边界增加固定开销。
 */
export class AgentTokenEstimator {
  constructor(private readonly exactCounter?: ExactTokenCounter) {}

  text(text: string): AgentTokenEstimate {
    if (this.exactCounter) {
      return { tokens: nonNegativeInteger(this.exactCounter(text)), estimated: false }
    }
    return { tokens: Math.ceil(Buffer.byteLength(text, 'utf8') / 2), estimated: true }
  }

  messages(messages: readonly ChatAdapterMessage[]): AgentTokenEstimate {
    let tokens = 0
    let estimated = false
    for (const message of messages) {
      const result = this.text(JSON.stringify(message))
      tokens += result.tokens + 8
      estimated ||= result.estimated
    }
    return { tokens, estimated }
  }

  tools(tools: readonly ChatAdapterToolDefinition[]): AgentTokenEstimate {
    return this.text(JSON.stringify(tools))
  }
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Token counter 返回了无效结果')
  return Math.ceil(value)
}
