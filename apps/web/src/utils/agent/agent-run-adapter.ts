import type {
  AgentMessage,
  AgentContextBudgetState,
  AgentRunStatus,
  AgentRunTerminalStatus,
  AgentSandboxStatus,
  AgentStreamEvent,
  AgentThinkingEffort,
  AgentThreadSummary,
  SuperMindClient,
} from '@supermind/sdk'
import type {
  ChatModelAdapter,
  ChatModelRunResult,
  ThreadAssistantMessagePart,
  ThreadMessage,
  ThreadMessageLike,
} from '@assistant-ui/react'

export interface AgentRunAdapterContext {
  threadId: string | null
  model: string
  thinkingEffort: AgentThinkingEffort
  selectedSkillNames: readonly string[]
  websiteMode?: boolean
  onThreadCreated: (thread: AgentThreadSummary) => void
  onRunCreated?: (run: { id: string; threadId: string }) => void
  onRunFinished?: (status: AgentRunTerminalStatus) => void
  onContextBudget?: (budget: AgentContextBudgetState) => void
  onContextCompressed?: (event: Extract<AgentStreamEvent, { type: 'context-compressed' }>) => void
  onSandboxStatus?: (status: AgentSandboxStatus, sandboxId?: string) => void
  onRunProgressChange?: (stage: AgentRunProgressStage | null) => void
  onUserQuestion?: (
    question: Extract<AgentStreamEvent, { type: 'user-question-asked' }>['question'] | null,
  ) => void
}

export type AgentRunProgressStage =
  'creating-thread' | 'starting-run' | 'preparing-sandbox' | 'thinking'

export interface AgentRunMetadata extends Record<string, unknown> {
  model?: string
  runId?: string
  modelCalls?: number
  toolCalls?: number
  totalTokens?: number | null
  runStatus?: AgentRunStatus | 'idle'
}

type MutablePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool-call'
      toolCallId: string
      toolName: string
      args: Record<string, string | number | boolean | null>
      argsText: string
      progress?: {
        content: string
        details?: Record<string, string | number | boolean | null>
      }
      result?: {
        summary: string
        status: string
        audit?: Record<string, string | number | boolean | null>
      }
      isError?: boolean
    }

/**
 * 把 Agent 后端（thread/run/SSE call-loop）接到 assistant-ui LocalRuntime。
 * 一次用户发送对应一次完整 run：reasoning / tool-call(+result) / text 都折叠进同一条 assistant 消息。
 */
export function createAgentRunAdapter(
  client: SuperMindClient,
  getContext: () => AgentRunAdapterContext,
  onError?: (error: unknown) => void,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const context = getContext()
      const input = latestUserText(messages)
      if (!input) return

      let threadId = context.threadId
      if (!threadId) {
        if (!context.model) throw new Error('没有可用的 Agent 模型')
        context.onRunProgressChange?.('creating-thread')
        const created = await client.agent.threads.create({ model: context.model })
        threadId = created.id
        context.onThreadCreated(created)
      }

      context.onRunProgressChange?.('starting-run')
      const streamStartTime = Date.now()
      const run = await client.agent.runs.create(threadId, {
        input,
        thinkingEffort: context.thinkingEffort,
        ...(context.selectedSkillNames.length === 0
          ? {}
          : { skills: context.selectedSkillNames.map((name) => ({ name })) }),
        ...(context.websiteMode ? { mode: 'website' as const } : {}),
      })
      context.onRunCreated?.({ id: run.id, threadId })
      context.onRunProgressChange?.('preparing-sandbox')
      const metadata: AgentRunMetadata = { model: context.model, runId: run.id }
      const parts: MutablePart[] = []
      let runError: Error | null = null

      // 仅断开本端 SSE；浏览器刷新/卸载不得调用 cancel（规范：断线不取消进程内 run）。
      // 显式「停止」由 UI 先调 cancel API，再触发本 abortSignal。
      try {
        for await (const event of client.agent.runs.subscribe(run.id, {
          after: -1,
          signal: abortSignal,
        })) {
          if (event.type === 'context-budget') context.onContextBudget?.(event)
          if (event.type === 'context-compressed') context.onContextCompressed?.(event)
          if (event.type === 'user-question-asked') context.onUserQuestion?.(event.question)
          if (event.type === 'user-question-answered' || event.type === 'user-question-skipped')
            context.onUserQuestion?.(null)
          if (event.type === 'sandbox-status') {
            context.onSandboxStatus?.(event.status, event.sandboxId)
            context.onRunProgressChange?.(
              event.status === 'ready' ? 'thinking' : 'preparing-sandbox',
            )
          }
          if (isRenderableAgentEvent(event)) context.onRunProgressChange?.(null)
          applyAgentEvent(parts, metadata, event)
          const content = toAssistantParts(parts)
          if (event.type === 'run-terminal') {
            const incomplete =
              event.status === 'failed' ||
              event.status === 'interrupted' ||
              event.status === 'limit_reached'
            const result: ChatModelRunResult = {
              content,
              metadata: {
                custom: { ...metadata },
                timing: {
                  streamStartTime,
                  totalStreamTime: Date.now() - streamStartTime,
                  totalChunks: 0,
                  toolCallCount: metadata.toolCalls ?? 0,
                },
              },
              status:
                event.status === 'cancelled'
                  ? { type: 'incomplete', reason: 'cancelled' }
                  : incomplete
                    ? {
                        type: 'incomplete',
                        reason: 'error',
                        ...(runError === null ? {} : { error: runError.message }),
                      }
                    : { type: 'complete', reason: 'stop' },
            }
            yield result
            context.onRunProgressChange?.(null)
            context.onRunFinished?.(event.status)
            return
          }
          if (event.type === 'error') {
            runError = new Error(event.error.message)
            continue
          }
          yield { content, metadata: { custom: { ...metadata } } }
        }
        if (runError) throw runError
      } catch (error) {
        if (abortSignal.aborted) {
          // 本地停止读取；服务端 run 继续。不把状态标成 cancelled。
          yield {
            content: toAssistantParts(parts),
            metadata: { custom: { ...metadata, runStatus: 'running' } },
          }
          return
        }
        context.onRunProgressChange?.(null)
        onError?.(error)
        throw error
      }
    },
  }
}

function isRenderableAgentEvent(event: AgentStreamEvent): boolean {
  return (
    event.type === 'reasoning-delta' ||
    event.type === 'text-delta' ||
    event.type === 'tool-call' ||
    event.type === 'tool-progress'
  )
}

export function agentMessagesToThreadMessages(
  messages: readonly AgentMessage[],
  options?: { lastRunStatus?: AgentRunStatus | null },
): ThreadMessageLike[] {
  const result: ThreadMessageLike[] = []
  let pending: {
    id: string
    role: 'assistant'
    content: MutablePart[]
    createdAt: Date
  } | null = null

  const flush = () => {
    if (!pending) return
    const interrupted = options?.lastRunStatus === 'interrupted'
    result.push({
      id: pending.id,
      role: 'assistant',
      content: toAssistantParts(pending.content),
      status: interrupted
        ? { type: 'incomplete', reason: 'error', error: '服务重启导致运行中断，未自动重放' }
        : { type: 'complete', reason: 'stop' },
      metadata: interrupted
        ? { custom: { runStatus: 'interrupted' } satisfies AgentRunMetadata }
        : undefined,
      createdAt: pending.createdAt,
    })
    pending = null
  }

  for (const message of messages) {
    if (message.role === 'user') {
      flush()
      result.push({
        id: message.id,
        role: 'user',
        content: message.parts.flatMap((part) =>
          part.type === 'text' ? [{ type: 'text' as const, text: part.text }] : [],
        ),
        createdAt: parseDate(message.createdAt),
      })
      continue
    }

    if (message.role === 'assistant') {
      if (!pending) {
        pending = {
          id: message.id,
          role: 'assistant',
          content: [],
          createdAt: parseDate(message.createdAt),
        }
      }
      for (const part of message.parts) {
        if (part.type === 'text') {
          pending.content.push({ type: 'text', text: part.text })
        } else if (part.type === 'reasoning') {
          pending.content.push({ type: 'reasoning', text: part.text })
        } else if (part.type === 'tool-call') {
          pending.content.push({
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: toJsonObject(part.args),
            argsText: JSON.stringify(part.args),
          })
        }
      }
      continue
    }

    for (const part of message.parts) {
      if (part.type !== 'tool-result' || !pending) continue
      const index = pending.content.findIndex(
        (item) => item.type === 'tool-call' && item.toolCallId === part.toolCallId,
      )
      if (index < 0) continue
      const toolCall = pending.content[index]
      if (!toolCall || toolCall.type !== 'tool-call') continue
      pending.content[index] = {
        ...toolCall,
        result: {
          summary: part.summary,
          status: part.status,
          ...(part.audit === undefined ? {} : { audit: toJsonObject(part.audit) }),
        },
        isError: part.isError,
      }
    }
  }

  flush()
  return result
}

function applyAgentEvent(
  parts: MutablePart[],
  metadata: AgentRunMetadata,
  event: AgentStreamEvent,
): void {
  switch (event.type) {
    case 'reasoning-delta':
      appendTextLike(parts, 'reasoning', event.delta)
      return
    case 'text-delta':
      appendTextLike(parts, 'text', event.delta)
      return
    case 'tool-call':
      parts.push({
        type: 'tool-call',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: toJsonObject(event.args),
        argsText: JSON.stringify(event.args),
      })
      return
    case 'tool-progress': {
      const progress = {
        content: event.content,
        ...(event.details === undefined ? {} : { details: toJsonObject(event.details) }),
      }
      const index = parts.findIndex(
        (part) => part.type === 'tool-call' && part.toolCallId === event.toolCallId,
      )
      if (index < 0) {
        parts.push({
          type: 'tool-call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: {},
          argsText: '{}',
          progress,
        })
        return
      }
      const toolCall = parts[index]
      if (!toolCall || toolCall.type !== 'tool-call') return
      parts[index] = { ...toolCall, progress }
      return
    }
    case 'tool-result': {
      const index = parts.findIndex(
        (part) => part.type === 'tool-call' && part.toolCallId === event.toolCallId,
      )
      if (index < 0) {
        parts.push({
          type: 'tool-call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: {},
          argsText: '{}',
          result: {
            summary: event.summary,
            status: event.status,
            ...(event.audit === undefined ? {} : { audit: toJsonObject(event.audit) }),
          },
          isError: event.isError,
        })
        return
      }
      const toolCall = parts[index]
      if (!toolCall || toolCall.type !== 'tool-call') return
      const completedToolCall = { ...toolCall }
      delete completedToolCall.progress
      parts[index] = {
        ...completedToolCall,
        result: {
          summary: event.summary,
          status: event.status,
          ...(event.audit === undefined ? {} : { audit: toJsonObject(event.audit) }),
        },
        isError: event.isError,
      }
      return
    }
    case 'usage':
      metadata.modelCalls = event.usage.modelCalls
      metadata.toolCalls = event.usage.toolCalls
      metadata.totalTokens = event.usage.totalTokens
      return
    default:
      return
  }
}

function appendTextLike(parts: MutablePart[], type: 'text' | 'reasoning', delta: string): void {
  const last = parts.at(-1)
  if (last && last.type === type) {
    last.text += delta
    return
  }
  parts.push({ type, text: delta })
}

function toAssistantParts(parts: readonly MutablePart[]): ThreadAssistantMessagePart[] {
  return parts.map((part) => {
    if (part.type === 'tool-call') {
      return {
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: part.args,
        argsText: part.argsText,
        ...(part.progress === undefined ? {} : { artifact: part.progress }),
        ...(part.result === undefined ? {} : { result: part.result }),
        ...(part.isError === undefined ? {} : { isError: part.isError }),
      } as ThreadAssistantMessagePart
    }
    return { ...part } as ThreadAssistantMessagePart
  })
}

function toJsonObject(
  value: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      typeof entry === 'boolean' ||
      entry === null
    ) {
      result[key] = entry
    } else if (entry !== undefined) {
      result[key] = JSON.stringify(entry)
    }
  }
  return result
}

function latestUserText(messages: readonly ThreadMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user') continue
    return message.content
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('')
      .trim()
  }
  return ''
}

function parseDate(value: string): Date {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}
