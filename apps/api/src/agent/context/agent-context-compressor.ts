import type { ChatAdapterMessage } from '../../chat/adapters/chat-adapter'
import type { AgentContextCompressionLevel } from './agent-context-budget'

const RECENT_TURNS_TO_KEEP = 4
const COMPACT_TOOL_RESULT_CHARS = 512

export interface AgentContextCompressionResult {
  messages: ChatAdapterMessage[]
  changed: boolean
  notes: string[]
}

/**
 * 可重复、无模型参与的轻量/中度压缩。它不重排消息、不修改最后一个 user 输入，也不删除
 * 未完成 tool call；forced 由独立的结构化摘要流程处理。
 */
export function compressAgentContext(
  messages: readonly ChatAdapterMessage[],
  level: Exclude<AgentContextCompressionLevel, 'forced'>,
): AgentContextCompressionResult {
  if (level === 'none') return { messages: messages.map(clone), changed: false, notes: [] }

  const protectedTurnStart = recentTurnStart(messages, RECENT_TURNS_TO_KEEP)
  const currentTurnStart = lastUserIndex(messages)
  const notes = new Set<string>()
  const compressed = messages.map((message, index) => {
    const next = clone(message)
    if (next.role === 'assistant' && next.reasoningContent) {
      const removeReasoning =
        level === 'moderate' ? index < currentTurnStart : index < protectedTurnStart
      if (removeReasoning) {
        delete next.reasoningContent
        notes.add(level === 'moderate' ? 'removed-completed-reasoning' : 'removed-old-reasoning')
      }
    }

    if (level === 'moderate' && next.role === 'tool' && index < currentTurnStart) {
      const compact = compactToolResult(next.content)
      if (compact !== next.content) {
        next.content = compact
        notes.add('compacted-completed-tool-results')
      }
    }
    return next
  })

  return {
    messages: compressed,
    changed: notes.size > 0,
    notes: [...notes],
  }
}

function compactToolResult(content: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return bounded(`[tool-result trust="untrusted" summary=${JSON.stringify(content)}]`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bounded(content)
  const record = parsed as Record<string, unknown>
  return bounded(
    JSON.stringify({
      trust: 'untrusted-tool-output',
      status: record.status,
      isError: record.isError,
      summary: record.summary,
    }),
  )
}

function bounded(value: string): string {
  if (value.length <= COMPACT_TOOL_RESULT_CHARS) return value
  return `${value.slice(0, COMPACT_TOOL_RESULT_CHARS)}…[truncated]`
}

function recentTurnStart(messages: readonly ChatAdapterMessage[], count: number): number {
  const indexes = messages
    .map((message, index) => (message.role === 'user' ? index : -1))
    .filter((index) => index >= 0)
  return indexes.at(-count) ?? 0
}

function lastUserIndex(messages: readonly ChatAdapterMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index
  }
  return messages.length
}

function clone(message: ChatAdapterMessage): ChatAdapterMessage {
  return {
    ...message,
    ...(message.toolCalls
      ? {
          toolCalls: message.toolCalls.map((call) => ({
            ...call,
            arguments: { ...call.arguments },
          })),
        }
      : {}),
  }
}
