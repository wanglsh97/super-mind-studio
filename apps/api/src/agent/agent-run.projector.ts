import type {
  AgentMessagePart,
  AgentMessageRole,
  AgentRunLimitReason,
  AgentRunTerminalStatus,
  AgentStreamEvent,
  AgentToolCallStatus,
} from '@supermind/sdk'
import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type { AssistantMessageEvent } from '@earendil-works/pi-ai'

export interface ProjectedMessage {
  id: string
  role: AgentMessageRole
  parts: AgentMessagePart[]
}

export interface ProjectedToolCall {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  status: AgentToolCallStatus
  summary: string | null
  audit: Record<string, unknown> | null
  isError: boolean
}

export interface AgentRunUsageAggregate {
  modelCalls: number
  toolCalls: number
  webFetchCalls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  usageUnknown: boolean
}

const TERMINAL_FROM_ACTIVE: readonly AgentRunTerminalStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
  'limit_reached',
  'interrupted',
]

/**
 * Agent run 投影与状态机（纯逻辑，不依赖 Pi 运行时值）。
 *
 * 消费 Pi harness 的 `AgentEvent`，产出带单调递增 sequence 的平台 wire 事件（供持久化与
 * SSE 投影），并累积消息 parts 快照、工具调用记录与用量计数。终态由 `finalize` 决定，
 * 覆盖 succeeded/failed/cancelled/limit_reached/interrupted。
 */
export class AgentRunProjector {
  private sequence = 0
  private finished = false
  private readonly messages: ProjectedMessage[] = []
  private currentAssistant: ProjectedMessage | undefined
  private readonly toolCalls = new Map<string, ProjectedToolCall>()
  private readonly usage: AgentRunUsageAggregate = {
    modelCalls: 0,
    toolCalls: 0,
    webFetchCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    usageUnknown: false,
  }
  private failureError: { code: string; message: string; retryable: boolean } | undefined

  constructor(
    private readonly runId: string,
    private readonly createId: () => string,
  ) {}

  get lastSequence(): number {
    return this.sequence - 1
  }

  /**
   * 持久问卷等 run 外部事件已占用 sequence 后推进本地游标，避免后续 Pi 事件复用同一序号。
   */
  advancePast(sequence: number): void {
    if (!Number.isInteger(sequence) || sequence < 0) {
      throw new Error(`Invalid external Agent event sequence: ${sequence}`)
    }
    this.sequence = Math.max(this.sequence, sequence + 1)
  }

  /** run 开始事件（sequence 0）。 */
  start(): AgentStreamEvent[] {
    return [this.emit({ type: 'run-status', status: 'running' })]
  }

  sandboxStatus(
    input: { status: 'creating' | 'failed' } | { status: 'ready'; sandboxId: string },
  ): AgentStreamEvent[] {
    if (this.finished) return []
    return [this.emit({ type: 'sandbox-status', ...input })]
  }

  ingest(event: AgentEvent): AgentStreamEvent[] {
    switch (event.type) {
      case 'turn_start':
        this.usage.modelCalls += 1
        return []
      case 'message_start':
        return this.onMessageStart(event.message)
      case 'message_update':
        return this.onAssistantEvent(event.assistantMessageEvent)
      case 'message_end':
        return this.onMessageEnd()
      case 'tool_execution_start':
        return this.onToolStart(event.toolCallId, event.toolName, event.args)
      case 'tool_execution_end':
        return this.onToolEnd(event.toolCallId, event.toolName, event.result, event.isError)
      default:
        return []
    }
  }

  contextBudget(input: {
    usedTokens: number
    usableTokens: number
    contextWindowTokens: number
    estimated: boolean
    level: 'none' | 'light' | 'moderate' | 'forced'
    summaryId?: string
  }): AgentStreamEvent[] {
    if (this.finished) return []
    return [this.emit({ type: 'context-budget', ...input })]
  }

  contextCompressed(input: {
    level: 'light' | 'moderate' | 'forced'
    notes: string[]
    summaryId?: string
    revision?: number
    coveredThroughSequence?: number
  }): AgentStreamEvent[] {
    if (this.finished) return []
    return [this.emit({ type: 'context-compressed', ...input })]
  }

  skillActivation(
    input: Omit<
      Extract<AgentStreamEvent, { type: 'skill-activation' }>,
      'type' | 'sequence' | 'runId'
    >,
  ): AgentStreamEvent[] {
    if (this.finished) return []
    return [this.emit({ type: 'skill-activation', ...input })]
  }

  /** 终结 run，产出 usage 与终态事件。幂等：重复调用返回空。 */
  finalize(
    status: AgentRunTerminalStatus,
    options: {
      limitReason?: AgentRunLimitReason
      error?: { code: string; message: string; retryable: boolean }
    } = {},
  ): AgentStreamEvent[] {
    if (this.finished) return []
    if (!TERMINAL_FROM_ACTIVE.includes(status)) {
      throw new Error(`Invalid terminal agent run status: ${status}`)
    }
    this.finished = true

    const events: AgentStreamEvent[] = []
    // 关闭仍打开的 assistant 消息，避免快照丢失。
    if (this.currentAssistant) {
      events.push(this.emit({ type: 'message-end', messageId: this.currentAssistant.id }))
      this.messages.push(this.currentAssistant)
      this.currentAssistant = undefined
    }

    events.push(
      this.emit({
        type: 'usage',
        usage: {
          inputTokens: this.usage.usageUnknown ? null : this.usage.inputTokens,
          outputTokens: this.usage.usageUnknown ? null : this.usage.outputTokens,
          totalTokens: this.usage.usageUnknown ? null : this.usage.totalTokens,
          estimatedCostCny: null,
          usageUnknown: this.usage.usageUnknown,
          modelCalls: this.usage.modelCalls,
          toolCalls: this.usage.toolCalls,
          webFetchCalls: this.usage.webFetchCalls,
        },
      }),
    )

    const error = options.error ?? this.failureError
    if (error) {
      events.push(
        this.emit({
          type: 'error',
          error: {
            requestId: this.runId,
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          },
        }),
      )
    }

    events.push(
      this.emit({
        type: 'run-terminal',
        status,
        limitReason: options.limitReason ?? null,
      }),
    )
    return events
  }

  messagesSnapshot(): ProjectedMessage[] {
    return this.messages.map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.parts.map((part) => ({ ...part })),
    }))
  }

  toolCallRecords(): ProjectedToolCall[] {
    return [...this.toolCalls.values()]
  }

  usageAggregate(): AgentRunUsageAggregate {
    return { ...this.usage }
  }

  /** 若 Pi 已给出失败（assistant stopReason=error），返回归一化错误。 */
  detectedFailure(): { code: string; message: string; retryable: boolean } | undefined {
    return this.failureError
  }

  private onMessageStart(message: AgentEventMessage): AgentStreamEvent[] {
    if (message.role !== 'assistant') return []
    return this.beginAssistant()
  }

  private beginAssistant(): AgentStreamEvent[] {
    if (this.currentAssistant) return []
    this.currentAssistant = { id: this.createId(), role: 'assistant', parts: [] }
    return [
      this.emit({ type: 'message-start', messageId: this.currentAssistant.id, role: 'assistant' }),
    ]
  }

  private onAssistantEvent(event: AssistantMessageEvent): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = []
    if (
      !this.currentAssistant &&
      (event.type === 'text_delta' ||
        event.type === 'thinking_delta' ||
        event.type === 'toolcall_end')
    ) {
      events.push(...this.beginAssistant())
    }
    const assistant = this.currentAssistant
    if (!assistant) return events

    if (event.type === 'text_delta') {
      this.appendText(assistant, 'text', event.delta)
      events.push(this.emit({ type: 'text-delta', messageId: assistant.id, delta: event.delta }))
      return events
    }
    if (event.type === 'thinking_delta') {
      this.appendText(assistant, 'reasoning', event.delta)
      events.push(
        this.emit({ type: 'reasoning-delta', messageId: assistant.id, delta: event.delta }),
      )
      return events
    }
    if (event.type === 'toolcall_end') {
      const args = sanitizeToolArgs(
        event.toolCall.name,
        (event.toolCall.arguments ?? {}) as Record<string, unknown>,
      )
      assistant.parts.push({
        type: 'tool-call',
        toolCallId: event.toolCall.id,
        toolName: event.toolCall.name,
        args,
      })
      events.push(
        this.emit({
          type: 'tool-call',
          messageId: assistant.id,
          toolCallId: event.toolCall.id,
          toolName: event.toolCall.name,
          args,
        }),
      )
      return events
    }
    return events
  }

  private onMessageEnd(): AgentStreamEvent[] {
    if (!this.currentAssistant) return []
    const message = this.currentAssistant
    this.currentAssistant = undefined
    this.messages.push(message)
    return [this.emit({ type: 'message-end', messageId: message.id })]
  }

  private onToolStart(toolCallId: string, toolName: string, args: unknown): AgentStreamEvent[] {
    const safeArgs = sanitizeToolArgs(toolName, asRecord(args))
    this.toolCalls.set(toolCallId, {
      toolCallId,
      toolName,
      args: safeArgs,
      status: 'running',
      summary: null,
      audit: null,
      isError: false,
    })
    return [this.emit({ type: 'tool-status', toolCallId, toolName, status: 'running' })]
  }

  private onToolEnd(
    toolCallId: string,
    toolName: string,
    result: unknown,
    isError: boolean,
  ): AgentStreamEvent[] {
    this.usage.toolCalls += 1
    if (toolName === 'web_fetch') this.usage.webFetchCalls += 1

    const { summary, audit } = extractToolResult(result)
    const status: AgentToolCallStatus = isError ? 'failed' : 'succeeded'
    const existing = this.toolCalls.get(toolCallId)
    this.toolCalls.set(toolCallId, {
      toolCallId,
      toolName,
      args: existing?.args ?? {},
      status,
      summary,
      audit,
      isError,
    })

    // 工具结果作为独立的 tool 消息进入快照。
    const toolMessage: ProjectedMessage = {
      id: this.createId(),
      role: 'tool',
      parts: [
        {
          type: 'tool-result',
          toolCallId,
          toolName,
          status,
          isError,
          summary: summary ?? '',
          ...(audit === null ? {} : { audit }),
        },
      ],
    }
    this.messages.push(toolMessage)

    const events: AgentStreamEvent[] = [
      this.emit({
        type: 'tool-result',
        toolCallId,
        toolName,
        status,
        isError,
        summary: summary ?? '',
        ...(audit === null ? {} : { audit }),
      }),
    ]
    const fileEvent = projectFileOperation(toolCallId, toolName, status, audit)
    if (fileEvent) events.push(this.emit(fileEvent))
    return events
  }

  private appendText(message: ProjectedMessage, kind: 'text' | 'reasoning', delta: string): void {
    const last = message.parts.at(-1)
    if (last && last.type === kind) {
      last.text += delta
      return
    }
    message.parts.push(
      kind === 'text' ? { type: 'text', text: delta } : { type: 'reasoning', text: delta },
    )
  }

  private emit<D extends AgentStreamDraft>(event: D): AgentStreamEvent {
    const projected = { ...event, sequence: this.sequence, runId: this.runId }
    this.sequence += 1
    return projected as unknown as AgentStreamEvent
  }

  /** 记录来自模型的用量增量（由服务在每次模型调用结束时调用）。 */
  addUsage(usage: {
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
    usageUnknown: boolean
  }): void {
    if (usage.usageUnknown) {
      this.usage.usageUnknown = true
      return
    }
    this.usage.inputTokens += usage.inputTokens ?? 0
    this.usage.outputTokens += usage.outputTokens ?? 0
    this.usage.totalTokens += usage.totalTokens ?? 0
  }

  /** 记录 Pi 检测到的失败（assistant stopReason=error）。 */
  recordFailure(error: { code: string; message: string; retryable: boolean }): void {
    this.failureError = error
  }
}

type AgentEventMessage = Extract<AgentEvent, { type: 'message_start' }>['message']

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never
type AgentStreamDraft = DistributiveOmit<AgentStreamEvent, 'sequence' | 'runId'>

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function sanitizeToolArgs(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName !== 'write_file' || typeof args.content !== 'string') return args
  return {
    ...args,
    content: `[omitted ${new TextEncoder().encode(args.content).byteLength} bytes]`,
  }
}

function extractToolResult(result: unknown): {
  summary: string | null
  audit: Record<string, unknown> | null
} {
  const record = asRecord(result)
  const details = asRecord(record.details)
  const content = textFromContent(record.content)
  const normalizedError = parseNormalizedToolError(content)
  const summary =
    typeof details.summary === 'string' ? details.summary : (normalizedError?.message ?? content)
  const audit = asRecord(details.audit)
  return {
    summary: summary && summary.length > 0 ? summary : null,
    audit:
      Object.keys(audit).length > 0
        ? audit
        : normalizedError === null
          ? null
          : { code: normalizedError.code },
  }
}

function parseNormalizedToolError(value: string): { code: string; message: string } | null {
  const match = /^\[([A-Z][A-Z0-9_]{1,63})\]\s+([\s\S]+)$/.exec(value)
  if (!match?.[1] || !match[2]) return null
  return { code: match[1], message: match[2] }
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((part) =>
      typeof part === 'object' && part !== null && (part as { text?: unknown }).text
        ? String((part as { text: string }).text)
        : '',
    )
    .join('')
    .slice(0, 200)
}

function projectFileOperation(
  toolCallId: string,
  toolName: string,
  status: AgentToolCallStatus,
  audit: Record<string, unknown> | null,
): Omit<Extract<AgentStreamEvent, { type: 'file-operation' }>, 'sequence' | 'runId'> | undefined {
  if (toolName !== 'export_file' || !audit) return undefined
  const path = typeof audit.path === 'string' ? audit.path : ''
  const size = typeof audit.size === 'number' ? audit.size : null
  const fileId = typeof audit.fileId === 'string' ? audit.fileId : undefined
  const sha256 = typeof audit.sha256 === 'string' ? audit.sha256 : undefined
  if (!path) return undefined
  return {
    type: 'file-operation',
    toolCallId,
    status,
    operation: 'export-output',
    direction: 'output',
    ...(fileId === undefined ? {} : { fileId }),
    path,
    size,
    ...(sha256 === undefined ? {} : { sha256 }),
  }
}
