import type { AgentMediaReferencePart, AgentMessagePart } from '@supermind/sdk'

import type { AgentMessage, AgentMessageRole } from '../../generated/prisma/client'
import type { ChatAdapterMessage } from '../../chat/adapters/chat-adapter'
import type { AgentContextSummaryV1 } from './agent-context-summary.schema'
import { mediaReferencePlaceholder } from './agent-media-placeholder'

export type HistoricalReasoningMode = 'native' | 'tagged'

export interface AgentHistoryAssemblyInput {
  persistedMessages: readonly AgentMessage[]
  currentRunId: string
  currentMessages: readonly ChatAdapterMessage[]
  reasoningMode?: HistoricalReasoningMode
  summary?: { content: AgentContextSummaryV1; coveredThroughSequence: number }
}

/**
 * 将 PostgreSQL 真源历史前置到当前 Pi context。当前 run 已预写入的 user message 必须排除，
 * 否则它会与 Pi `agent.prompt()` 产生的本轮 user message 重复。
 */
export function assembleAgentHistory(input: AgentHistoryAssemblyInput): ChatAdapterMessage[] {
  const system = input.currentMessages.filter((message) => message.role === 'system')
  const current = input.currentMessages.filter((message) => message.role !== 'system')
  const summary = input.summary
    ? [
        {
          role: 'user' as const,
          content: `<conversation_summary trust="historical-unverified">${JSON.stringify(input.summary.content)}</conversation_summary>`,
        },
      ]
    : []
  const history = input.persistedMessages
    .filter(
      (message) =>
        message.runId !== input.currentRunId &&
        message.sequence > (input.summary?.coveredThroughSequence ?? -1),
    )
    .flatMap((message) => persistedMessageToAdapter(message, input.reasoningMode ?? 'native'))
  return [...system, ...summary, ...history, ...current]
}

/** 选择强制摘要覆盖范围，同时硬保留最后 `minimumTurns` 个完整 turns。 */
export function selectMessagesForForcedSummary(
  messages: readonly AgentMessage[],
  currentRunId: string,
  coveredThroughSequence: number,
  minimumTurns = 2,
): AgentMessage[] {
  const uncovered = messages.filter(
    (message) => message.runId !== currentRunId && message.sequence > coveredThroughSequence,
  )
  const userIndexes = uncovered
    .map((message, index) => (message.role === 'USER' ? index : -1))
    .filter((index) => index >= 0)
  const keepFrom = userIndexes.at(-minimumTurns) ?? 0
  return uncovered.slice(0, keepFrom)
}

export function persistedMessageToAdapter(
  message: Pick<AgentMessage, 'role' | 'parts'>,
  reasoningMode: HistoricalReasoningMode = 'native',
): ChatAdapterMessage[] {
  const parts = (message.parts as unknown as AgentMessagePart[]) ?? []
  if (message.role === 'USER') return [{ role: 'user', content: visibleContent(parts) }]

  if (message.role === 'ASSISTANT') {
    const reasoning = parts
      .filter((part) => part.type === 'reasoning')
      .map((part) => part.text)
      .join('')
    const text = visibleContent(parts)
    const toolCalls = parts
      .filter((part) => part.type === 'tool-call')
      .map((part) => ({ id: part.toolCallId, name: part.toolName, arguments: part.args }))
    const content =
      reasoningMode === 'tagged' && reasoning
        ? `${taggedReasoning(reasoning)}${text ? `\n${text}` : ''}`
        : text
    return [
      {
        role: 'assistant',
        content,
        ...(reasoningMode === 'native' && reasoning ? { reasoningContent: reasoning } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
    ]
  }

  return parts
    .filter((part) => part.type === 'tool-result')
    .map((part) => ({
      role: 'tool' as const,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      content: JSON.stringify({
        trust: 'untrusted-tool-output',
        status: part.status,
        isError: part.isError,
        summary: part.summary,
        ...(part.audit === undefined ? {} : { audit: part.audit }),
      }),
    }))
}

/** 返回最后 N 个完整 user turns；供压缩阶段保护最近 4、最低 2 turns。 */
export function selectRecentCompleteTurns<T extends { role: AgentMessageRole }>(
  messages: readonly T[],
  count = 4,
): T[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('turn count must be positive')
  const userIndexes = messages
    .map((message, index) => (message.role === 'USER' ? index : -1))
    .filter((index) => index >= 0)
  const start = userIndexes.at(-count) ?? 0
  return messages.slice(start)
}

function visibleContent(parts: readonly AgentMessagePart[]): string {
  return parts
    .flatMap((part) => {
      if (part.type === 'text') return [part.text]
      if (part.type === 'media-reference')
        return [mediaReferencePlaceholder(part as AgentMediaReferencePart)]
      return []
    })
    .join('\n')
}

function taggedReasoning(value: string): string {
  return `<historical_reasoning trust="unverified">${escapeXml(value)}</historical_reasoning>`
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
