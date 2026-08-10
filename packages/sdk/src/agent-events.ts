import {
  AGENT_EXECUTION_ERROR_CODES,
  AGENT_FILE_OPERATIONS,
  AGENT_MESSAGE_ROLES,
  AGENT_RUN_LIMIT_REASONS,
  AGENT_RUN_STATUSES,
  AGENT_RUN_TERMINAL_STATUSES,
  AGENT_SANDBOX_LIMIT_REASONS,
  AGENT_SANDBOX_STATUSES,
  AGENT_SKILL_ACTIVATION_STATUSES,
  AGENT_TOOL_CALL_STATUSES,
  type AgentExecutionError,
  type AgentUserQuestion,
  type AgentUserQuestionAnswerItem,
  type AgentFileOperation,
  type AgentMessageRole,
  type AgentRunLimitReason,
  type AgentRunStatus,
  type AgentRunTerminalStatus,
  type AgentRunUsage,
  type AgentSandboxLimitReason,
  type AgentSandboxStatus,
  type AgentShellOutput,
  type AgentSkillActivationStatus,
  type AgentStreamEvent,
  type AgentToolCallStatus,
} from './agent-types.js'
import { AIGatewayProtocolError } from './errors.js'
import type { GatewayError } from './types.js'

/**
 * Agent 事件线协议（wire）。
 *
 * 为保持 API 与浏览器之间只有类型边界（服务端无需在运行时依赖 SDK 编解码），Agent 事件线
 * 直接采用 `AgentStreamEvent` 的 camelCase JSON。`encodeAgentEvent` 返回可序列化对象；
 * `decodeAgentEvent` 对收到的对象做严格校验与归一化，保证客户端只信任合法事件。
 */
export type AgentEventWire = Record<string, unknown>

export function encodeAgentEvent(event: AgentStreamEvent): AgentEventWire {
  return { ...(event as unknown as Record<string, unknown>) }
}

export function decodeAgentEvent(value: unknown, expectedRunId?: string): AgentStreamEvent {
  const record = asRecord(value)
  if (!record) throw protocol('Agent event must be an object')

  const type = stringValue(record.type)
  const sequence = record.sequence
  const runId = stringValue(record.runId)
  if (!type) throw protocol('Agent event type is invalid')
  if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 0) {
    throw protocol('Agent event sequence must be a non-negative integer')
  }
  if (!runId) throw protocol('Agent event runId is invalid')
  if (expectedRunId !== undefined && runId !== expectedRunId) {
    throw protocol('Agent event runId does not match the subscribed run')
  }

  const base = { sequence, runId }

  switch (type) {
    case 'run-status':
      return { type, ...base, status: runStatus(record.status) }
    case 'sandbox-status': {
      const sandboxId = optionalId(record.sandboxId)
      return {
        type,
        ...base,
        status: sandboxStatus(record.status),
        ...(sandboxId === undefined ? {} : { sandboxId }),
      }
    }
    case 'run-terminal':
      return {
        type,
        ...base,
        status: terminalStatus(record.status),
        limitReason: limitReason(record.limitReason),
      }
    case 'message-start':
      return { type, ...base, messageId: id(record.messageId), role: role(record.role) }
    case 'text-delta':
      return { type, ...base, messageId: id(record.messageId), delta: text(record.delta) }
    case 'reasoning-delta':
      return { type, ...base, messageId: id(record.messageId), delta: text(record.delta) }
    case 'user-question-asked':
      return { type, ...base, question: decodeAgentUserQuestion(record.question) }
    case 'user-question-answered':
      return {
        type,
        ...base,
        questionId: id(record.questionId),
        answers: userQuestionAnswers(record.answers),
      }
    case 'user-question-skipped':
      return { type, ...base, questionId: id(record.questionId) }
    case 'context-budget': {
      const summaryId = optionalId(record.summaryId)
      return {
        type,
        ...base,
        usedTokens: count(record.usedTokens),
        usableTokens: count(record.usableTokens),
        contextWindowTokens: count(record.contextWindowTokens),
        estimated: bool(record.estimated),
        level: compressionLevel(record.level),
        ...(summaryId === undefined ? {} : { summaryId }),
      }
    }
    case 'context-compressed': {
      const level = compressionLevel(record.level)
      if (level === 'none') throw protocol('Compressed context level cannot be none')
      const summaryId = optionalId(record.summaryId)
      const revision = optionalCount(record.revision)
      const coveredThroughSequence = optionalCount(record.coveredThroughSequence)
      return {
        type,
        ...base,
        level,
        notes: stringArray(record.notes, 'context compression notes'),
        ...(summaryId === undefined ? {} : { summaryId }),
        ...(revision === undefined ? {} : { revision }),
        ...(coveredThroughSequence === undefined ? {} : { coveredThroughSequence }),
      }
    }
    case 'message-end':
      return { type, ...base, messageId: id(record.messageId) }
    case 'tool-call':
      return {
        type,
        ...base,
        messageId: id(record.messageId),
        toolCallId: id(record.toolCallId),
        toolName: id(record.toolName),
        args: argsRecord(record.args),
      }
    case 'tool-status':
      return {
        type,
        ...base,
        toolCallId: id(record.toolCallId),
        toolName: id(record.toolName),
        status: toolStatus(record.status),
      }
    case 'tool-progress': {
      const details = asRecord(record.details)
      return {
        type,
        ...base,
        toolCallId: id(record.toolCallId),
        toolName: id(record.toolName),
        content: text(record.content),
        ...(details === undefined ? {} : { details }),
      }
    }
    case 'tool-result': {
      const audit = asRecord(record.audit)
      return {
        type,
        ...base,
        toolCallId: id(record.toolCallId),
        toolName: id(record.toolName),
        status: toolStatus(record.status),
        isError: bool(record.isError),
        summary: text(record.summary),
        ...(audit === undefined ? {} : { audit }),
      }
    }
    case 'skill-activation': {
      const packageSha256 = optionalSha256(record.packageSha256)
      const error = optionalExecutionError(record.error)
      return {
        type,
        ...base,
        status: skillActivationStatus(record.status),
        source: skillActivationSource(record.source),
        skillId: id(record.skillId),
        skillName: id(record.skillName),
        ...(packageSha256 === undefined ? {} : { packageSha256 }),
        ...(error === undefined ? {} : { error }),
      }
    }
    case 'shell-execution': {
      const stdout = optionalShellOutput(record.stdout)
      const stderr = optionalShellOutput(record.stderr)
      const error = optionalExecutionError(record.error)
      return {
        type,
        ...base,
        toolCallId: id(record.toolCallId),
        status: toolStatus(record.status),
        sandboxId: id(record.sandboxId),
        command: text(record.command),
        workingDirectory: text(record.workingDirectory),
        exitCode: nullableInteger(record.exitCode),
        durationMs: nullableCount(record.durationMs),
        ...(stdout === undefined ? {} : { stdout }),
        ...(stderr === undefined ? {} : { stderr }),
        limitReason: sandboxLimitReason(record.limitReason),
        ...(error === undefined ? {} : { error }),
      }
    }
    case 'file-operation': {
      const fileId = optionalId(record.fileId)
      const sha256 = optionalSha256(record.sha256)
      const error = optionalExecutionError(record.error)
      return {
        type,
        ...base,
        toolCallId: id(record.toolCallId),
        status: toolStatus(record.status),
        operation: fileOperation(record.operation),
        direction: fileDirection(record.direction),
        ...(fileId === undefined ? {} : { fileId }),
        path: text(record.path),
        size: nullableCount(record.size),
        ...(sha256 === undefined ? {} : { sha256 }),
        ...(error === undefined ? {} : { error }),
      }
    }
    case 'usage':
      return { type, ...base, usage: decodeUsage(record.usage) }
    case 'error':
      return { type, ...base, error: gatewayError(record.error) }
    default:
      throw protocol(`Agent event has an unknown type "${type}"`)
  }
}

export function decodeAgentUserQuestion(value: unknown): AgentUserQuestion {
  const question = asRecord(value)
  if (!question) throw protocol('Agent user question is invalid')
  const status = stringValue(question.status)
  if (!status || !['pending', 'answered', 'skipped', 'cancelled', 'interrupted'].includes(status)) {
    throw protocol('Agent user question status is invalid')
  }
  if (
    !Array.isArray(question.questions) ||
    question.questions.length < 1 ||
    question.questions.length > 4
  ) {
    throw protocol('Agent user question items are invalid')
  }
  if (
    typeof question.createdAt !== 'string' ||
    !(question.settledAt === null || typeof question.settledAt === 'string')
  ) {
    throw protocol('Agent user question timestamps are invalid')
  }
  return {
    id: id(question.id),
    runId: id(question.runId),
    status: status as AgentUserQuestion['status'],
    questions: question.questions.map((item) => userQuestionItem(item)),
    createdAt: question.createdAt,
    settledAt: question.settledAt,
  }
}

function userQuestionItem(value: unknown): AgentUserQuestion['questions'][number] {
  const item = asRecord(value)
  if (!item || !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 4) {
    throw protocol('Agent user question item is invalid')
  }
  return {
    id: id(item.id),
    header: text(item.header),
    question: text(item.question),
    multiSelect: bool(item.multiSelect),
    options: item.options.map((option) => {
      const record = asRecord(option)
      if (!record) throw protocol('Agent user question option is invalid')
      return {
        id: id(record.id),
        label: text(record.label),
        description: text(record.description),
      }
    }),
  }
}

function userQuestionAnswers(value: unknown): AgentUserQuestionAnswerItem[] {
  if (!Array.isArray(value)) throw protocol('Agent user question answers are invalid')
  return value.map((answer) => {
    const record = asRecord(answer)
    if (!record || !Array.isArray(record.selectedOptionIds)) {
      throw protocol('Agent user question answer is invalid')
    }
    const customText = record.customText
    if (customText !== undefined && typeof customText !== 'string') {
      throw protocol('Agent user question custom answer is invalid')
    }
    return {
      questionId: id(record.questionId),
      selectedOptionIds: record.selectedOptionIds.map((optionId) => id(optionId)),
      ...(customText === undefined ? {} : { customText }),
    }
  })
}

function decodeUsage(value: unknown): AgentRunUsage {
  const usage = asRecord(value)
  if (!usage) throw protocol('Agent usage payload is invalid')
  return {
    inputTokens: nullableNumber(usage.inputTokens),
    outputTokens: nullableNumber(usage.outputTokens),
    totalTokens: nullableNumber(usage.totalTokens),
    estimatedCostCny: nullableString(usage.estimatedCostCny),
    usageUnknown: bool(usage.usageUnknown),
    modelCalls: count(usage.modelCalls),
    toolCalls: count(usage.toolCalls),
    webFetchCalls: count(usage.webFetchCalls),
  }
}

function gatewayError(value: unknown): GatewayError {
  const error = asRecord(value)
  const requestId = stringValue(error?.requestId)
  const code = stringValue(error?.code)
  const message = stringValue(error?.message)
  const retryable = error?.retryable
  if (!error || !requestId || !code || !message || typeof retryable !== 'boolean') {
    throw protocol('Agent error payload is invalid')
  }
  const details = asRecord(error.details)
  return {
    requestId,
    code,
    message,
    retryable,
    ...(details === undefined ? {} : { details }),
  }
}

function runStatus(value: unknown): AgentRunStatus {
  const status = stringValue(value)
  if (!status || !(AGENT_RUN_STATUSES as readonly string[]).includes(status)) {
    throw protocol('Agent run status is invalid')
  }
  return status as AgentRunStatus
}

function sandboxStatus(value: unknown): AgentSandboxStatus {
  if (!AGENT_SANDBOX_STATUSES.includes(value as AgentSandboxStatus)) {
    throw protocol('Agent sandbox status is invalid')
  }
  return value as AgentSandboxStatus
}

function terminalStatus(value: unknown): AgentRunTerminalStatus {
  const status = stringValue(value)
  if (!status || !(AGENT_RUN_TERMINAL_STATUSES as readonly string[]).includes(status)) {
    throw protocol('Agent run terminal status is invalid')
  }
  return status as AgentRunTerminalStatus
}

function limitReason(value: unknown): AgentRunLimitReason | null {
  if (value === null || value === undefined) return null
  const reason = stringValue(value)
  if (!reason || !(AGENT_RUN_LIMIT_REASONS as readonly string[]).includes(reason)) {
    throw protocol('Agent run limit reason is invalid')
  }
  return reason as AgentRunLimitReason
}

function compressionLevel(value: unknown): 'none' | 'light' | 'moderate' | 'forced' {
  if (value === 'none' || value === 'light' || value === 'moderate' || value === 'forced')
    return value
  throw protocol('Agent context compression level is invalid')
}

function optionalId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return id(value)
}

function optionalCount(value: unknown): number | undefined {
  if (value === undefined) return undefined
  return count(value)
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw protocol(`${name} is invalid`)
  }
  return value
}

function role(value: unknown): AgentMessageRole {
  const parsed = stringValue(value)
  if (!parsed || !(AGENT_MESSAGE_ROLES as readonly string[]).includes(parsed)) {
    throw protocol('Agent message role is invalid')
  }
  return parsed as AgentMessageRole
}

function toolStatus(value: unknown): AgentToolCallStatus {
  const status = stringValue(value)
  if (!status || !(AGENT_TOOL_CALL_STATUSES as readonly string[]).includes(status)) {
    throw protocol('Agent tool call status is invalid')
  }
  return status as AgentToolCallStatus
}

function skillActivationStatus(value: unknown): AgentSkillActivationStatus {
  const status = stringValue(value)
  if (!status || !(AGENT_SKILL_ACTIVATION_STATUSES as readonly string[]).includes(status)) {
    throw protocol('Agent Skill activation status is invalid')
  }
  return status as AgentSkillActivationStatus
}

function skillActivationSource(value: unknown): 'manual' | 'model' {
  if (value === 'manual' || value === 'model') return value
  throw protocol('Agent Skill activation source is invalid')
}

function sandboxLimitReason(value: unknown): AgentSandboxLimitReason | null {
  if (value === null) return null
  const reason = stringValue(value)
  if (!reason || !(AGENT_SANDBOX_LIMIT_REASONS as readonly string[]).includes(reason)) {
    throw protocol('Agent sandbox limit reason is invalid')
  }
  return reason as AgentSandboxLimitReason
}

function fileOperation(value: unknown): AgentFileOperation {
  const operation = stringValue(value)
  if (!operation || !(AGENT_FILE_OPERATIONS as readonly string[]).includes(operation)) {
    throw protocol('Agent file operation is invalid')
  }
  return operation as AgentFileOperation
}

function fileDirection(value: unknown): 'input' | 'output' | 'internal' {
  if (value === 'input' || value === 'output' || value === 'internal') return value
  throw protocol('Agent file direction is invalid')
}

function optionalExecutionError(value: unknown): AgentExecutionError | undefined {
  if (value === undefined) return undefined
  const error = asRecord(value)
  const code = stringValue(error?.code)
  const message = stringValue(error?.message)
  const retryable = error?.retryable
  if (
    !error ||
    !code ||
    !(AGENT_EXECUTION_ERROR_CODES as readonly string[]).includes(code) ||
    !message ||
    typeof retryable !== 'boolean'
  ) {
    throw protocol('Agent execution error is invalid')
  }
  const details = asRecord(error.details)
  return {
    code: code as AgentExecutionError['code'],
    message,
    retryable,
    ...(details === undefined ? {} : { details }),
  }
}

function optionalShellOutput(value: unknown): AgentShellOutput | undefined {
  if (value === undefined) return undefined
  const output = asRecord(value)
  if (!output) throw protocol('Agent Shell output is invalid')
  return {
    bytes: count(output.bytes),
    truncated: bool(output.truncated),
    content: text(output.content),
  }
}

function optionalSha256(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw protocol('Agent SHA-256 value is invalid')
  }
  return value
}

function id(value: unknown): string {
  const parsed = stringValue(value)
  if (!parsed) throw protocol('Agent event identifier is invalid')
  return parsed
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw protocol('Agent event text field must be a string')
  return value
}

function argsRecord(value: unknown): Record<string, unknown> {
  const record = asRecord(value)
  if (!record) throw protocol('Agent tool call args must be an object')
  return record
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw protocol('Agent event boolean field is invalid')
  return value
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw protocol('Agent usage count must be a non-negative integer')
  }
  return value
}

function nullableCount(value: unknown): number | null {
  if (value === null) return null
  return count(value)
}

function nullableInteger(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw protocol('Agent event integer field is invalid')
  }
  return value
}

function nullableNumber(value: unknown): number | null {
  if (value === null || typeof value === 'number') return value
  throw protocol('Agent usage token value must be a number or null')
}

function nullableString(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value
  throw protocol('Agent usage cost value must be a string or null')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function protocol(message: string): AIGatewayProtocolError {
  return new AIGatewayProtocolError('unknown', message)
}
