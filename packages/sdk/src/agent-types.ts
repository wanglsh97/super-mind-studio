import type { GatewayError, TextModelId, Usage } from './types.js'
import type { SelectAgentSkill } from './agent-skill-types.js'

/**
 * Agent 公共契约。
 *
 * 本文件只暴露平台中立的业务契约，禁止泄漏 Pi harness 类型（Model/Context/AgentTool）
 * 或任何厂商响应结构。API 与 Web 只通过这些类型交换 Agent 数据。
 */

export const AGENT_RUN_STATUSES = [
  'running',
  'cancelling',
  'waiting_for_user',
  'succeeded',
  'failed',
  'cancelled',
  'limit_reached',
  'interrupted',
] as const
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number]

export const AGENT_RUN_TERMINAL_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
  'limit_reached',
  'interrupted',
] as const
export type AgentRunTerminalStatus = (typeof AGENT_RUN_TERMINAL_STATUSES)[number]

export const AGENT_RUN_LIMIT_REASONS = [
  'model_calls',
  'tool_calls',
  'web_fetch_calls',
  'duration',
  'context_window',
  'sandbox_duration',
  'shell_calls',
  'sandbox_output',
  'sandbox_egress',
  'sandbox_resource',
] as const
export type AgentRunLimitReason = (typeof AGENT_RUN_LIMIT_REASONS)[number]

export const AGENT_MESSAGE_ROLES = ['user', 'assistant', 'tool'] as const
export type AgentMessageRole = (typeof AGENT_MESSAGE_ROLES)[number]

export const AGENT_TOOL_CALL_STATUSES = ['running', 'succeeded', 'failed', 'cancelled'] as const
export type AgentToolCallStatus = (typeof AGENT_TOOL_CALL_STATUSES)[number]

export const AGENT_EXECUTION_ERROR_CODES = [
  'SKILL_NOT_ADDED',
  'SKILL_NOT_PUBLISHED',
  'SKILL_PACKAGE_UNAVAILABLE',
  'SKILL_PACKAGE_INTEGRITY_FAILED',
  'SKILL_CONTEXT_LIMIT',
  'SANDBOX_UNAVAILABLE',
  'SANDBOX_TIMEOUT',
  'SANDBOX_RESOURCE_LIMIT',
  'SHELL_COMMAND_TIMEOUT',
  'SHELL_CALL_LIMIT',
  'SHELL_OUTPUT_LIMIT',
  'FILE_NOT_FOUND',
  'FILE_ACCESS_DENIED',
  'FILE_SIZE_LIMIT',
  'OUTPUT_FILE_NOT_FOUND',
  'OUTPUT_FILE_INVALID',
  'OUTPUT_FILE_TOO_LARGE',
  'OUTPUT_RUN_QUOTA_EXCEEDED',
  'OUTPUT_USER_QUOTA_EXCEEDED',
  'OUTPUT_STORAGE_FAILED',
  'INVALID_PREVIEW_PORT',
  'WEBSITE_PROJECT_INVALID',
  'WEBSITE_BUILD_FAILED',
  'WEBSITE_ARCHIVE_FAILED',
  'WEBSITE_PREVIEW_FAILED',
  'RUN_CANCELLED',
] as const
export type AgentExecutionErrorCode = (typeof AGENT_EXECUTION_ERROR_CODES)[number]

export interface AgentExecutionError {
  code: AgentExecutionErrorCode
  message: string
  retryable: boolean
  details?: Record<string, unknown>
}

export const AGENT_SKILL_ACTIVATION_STATUSES = [
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const
export type AgentSkillActivationStatus = (typeof AGENT_SKILL_ACTIVATION_STATUSES)[number]

export const AGENT_SANDBOX_LIMIT_REASONS = [
  'duration',
  'command_timeout',
  'processes',
  'memory',
  'disk',
  'egress',
  'shell_calls',
  'output',
] as const
export type AgentSandboxLimitReason = (typeof AGENT_SANDBOX_LIMIT_REASONS)[number]

export const AGENT_SANDBOX_STATUSES = ['creating', 'ready', 'failed'] as const
export type AgentSandboxStatus = (typeof AGENT_SANDBOX_STATUSES)[number]

export const AGENT_FILE_OPERATIONS = ['stage-input', 'read', 'write', 'export-output'] as const
export type AgentFileOperation = (typeof AGENT_FILE_OPERATIONS)[number]

export interface AgentShellOutput {
  /** 截断前已观察到的字节数。 */
  bytes: number
  truncated: boolean
  /** 受单次与 Run 总输出预算约束的可展示文本。 */
  content: string
}

export interface AgentTextPart {
  type: 'text'
  text: string
}

export interface AgentReasoningPart {
  type: 'reasoning'
  text: string
}

export interface AgentToolCallPart {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

export interface AgentToolResultPart {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  status: AgentToolCallStatus
  isError: boolean
  summary: string
  /** 工具无关的审计投影（如 web_fetch 的 URL/状态/字节数）。不含凭证或敏感响应头。 */
  audit?: Record<string, unknown>
}

export interface AgentUserQuestionOption {
  id: string
  label: string
  description: string
}

export interface AgentUserQuestionItem {
  id: string
  header: string
  question: string
  options: AgentUserQuestionOption[]
  multiSelect: boolean
}

export interface AgentUserQuestion {
  id: string
  runId: string
  status: 'pending' | 'answered' | 'skipped' | 'cancelled' | 'interrupted'
  questions: AgentUserQuestionItem[]
  createdAt: string
  settledAt: string | null
}

export interface AgentUserQuestionAnswerItem {
  questionId: string
  selectedOptionIds: string[]
  customText?: string
}

export interface AnswerAgentUserQuestionRequest {
  answers: AgentUserQuestionAnswerItem[]
}

export interface AgentMediaReferencePart {
  type: 'media-reference'
  mediaId: string
  mediaType: 'image' | 'video' | 'audio' | 'file' | 'other'
  mimeType: string
  name: string
  source: 'user' | 'tool' | 'assistant'
  status: 'available' | 'expired' | 'missing' | 'blocked'
  description: string
}

export type AgentMessagePart =
  | AgentTextPart
  | AgentReasoningPart
  | AgentToolCallPart
  | AgentToolResultPart
  | AgentMediaReferencePart

export interface AgentMessage {
  id: string
  role: AgentMessageRole
  parts: AgentMessagePart[]
  createdAt: string
}

export interface AgentRunUsage extends Usage {
  modelCalls: number
  toolCalls: number
  webFetchCalls: number
}

export interface AgentTokenMetrics {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  reasoningTokens: number
}

export interface AgentTokenDailyUsage extends AgentTokenMetrics {
  date: string
  modelCalls: number
  cacheRate: number
}

export interface AgentTokenModelUsage extends AgentTokenMetrics {
  model: string
  modelCalls: number
  cacheRate: number
}

export interface AgentTokenAnalytics {
  from: string
  to: string
  timezoneOffsetMinutes: number
  daily: AgentTokenDailyUsage[]
  models: AgentTokenModelUsage[]
}

export interface AgentRunSummary {
  id: string
  threadId: string
  status: AgentRunStatus
  limitReason: AgentRunLimitReason | null
  usage: AgentRunUsage
  lastSequence: number
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export type AgentMcpServerConnectionStatus = 'configured' | 'ready' | 'error' | 'disabled'

export interface AgentMcpServerStatus {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  status: AgentMcpServerConnectionStatus
  allowedToolCount: number
  discoveredToolCount: number
  registeredToolCount: number
  errorCode: string | null
}

export interface UpdateAgentMcpServerRequest {
  enabled: boolean
}

export interface AgentThreadSummary {
  id: string
  title: string
  model: TextModelId
  createdAt: string
  updatedAt: string
}

export interface AgentThreadListPage {
  items: AgentThreadSummary[]
  page: number
  pageSize: number
  total: number
  pageCount: number
  /** 当前用户在不同 Thread 中进行中的 runs。 */
  activeRuns: AgentRunSummary[]
}

export interface AgentThreadSandbox {
  id: string
  status: 'creating' | 'ready' | 'idle' | 'failed'
  createdAt: string
  lastUsedAt: string
  expiresAt: string
}

export interface AgentThread extends AgentThreadSummary {
  messages: AgentMessage[]
  activeRun: AgentRunSummary | null
  /** 当前活跃 run 的待答问卷；非 pending、失效或已中断问卷不会返回。 */
  pendingQuestion: AgentUserQuestion | null
  /** 该会话最近一次 run（含已终结）；用于展示 interrupted 等终态。 */
  lastRun: AgentRunSummary | null
  contextSummary: AgentContextSummary | null
  /** 当前 Thread 全部持久化消息的 token 估算与绑定模型最大上下文。 */
  tokenUsage: {
    totalTokens: number
    contextWindowTokens: number | null
    estimated: boolean
  }
  /** 当前 Thread 可复用的临时 Sandbox；已销毁或尚未创建时为 null。 */
  sandbox: AgentThreadSandbox | null
}

export type AgentContextCompressionLevel = 'none' | 'light' | 'moderate' | 'forced'

export interface AgentContextSummaryContent {
  userGoals: string[]
  userConstraints: string[]
  decisions: { decision: string; rationale?: string }[]
  facts: { statement: string; source: string }[]
  openQuestions: string[]
  pendingTasks: { task: string; status: 'pending' | 'in_progress' | 'blocked' }[]
  toolFindings: { toolName: string; finding: string }[]
  referencedArtifacts: { name: string; reference: string }[]
  recentOutcome: string
  compressionNotes: string[]
}

export interface AgentContextSummary {
  id: string
  revision: number
  coveredThroughSequence: number
  schemaVersion: string
  modelId: string
  content: AgentContextSummaryContent
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  updatedAt: string
}

export interface AgentContextBudgetState {
  usedTokens: number
  usableTokens: number
  contextWindowTokens: number
  estimated: boolean
  level: AgentContextCompressionLevel
  summaryId?: string
}

export interface CreateAgentThreadRequest {
  model: TextModelId
  title?: string
}

export interface UpdateAgentThreadRequest {
  title: string
}

/** Agent run 级思考强度；厂商字段由服务端 Adapter 映射。 */
export type AgentThinkingEffort = 'fast' | 'balanced' | 'deep'

export interface CreateAgentRunRequest {
  input: string
  mode?: 'website' | 'document'
  /**
   * 三档用户表达在所有模型上保持一致，服务端映射为厂商支持的开关、budget 或 effort。
   * 省略时服务端默认 `balanced`。
   */
  thinkingEffort?: AgentThinkingEffort
  /**
   * 在首次模型调用前预激活的、当前用户已添加的 Skill。
   * 名称全局唯一；省略或传空数组时由模型自行决定是否调用 `skill`。
   */
  skills?: SelectAgentSkill[]
}

/**
 * Agent 事件流（已解析、camelCase）。
 *
 * 每个事件都带有单调递增的 `sequence`，客户端断线后可用最后一个 sequence 补读。
 */
export type AgentStreamEvent =
  | { type: 'run-status'; sequence: number; runId: string; status: AgentRunStatus }
  | {
      type: 'sandbox-status'
      sequence: number
      runId: string
      status: AgentSandboxStatus
      sandboxId?: string
    }
  | {
      type: 'run-terminal'
      sequence: number
      runId: string
      status: AgentRunTerminalStatus
      limitReason: AgentRunLimitReason | null
    }
  | {
      type: 'message-start'
      sequence: number
      runId: string
      messageId: string
      role: AgentMessageRole
    }
  | { type: 'text-delta'; sequence: number; runId: string; messageId: string; delta: string }
  | { type: 'reasoning-delta'; sequence: number; runId: string; messageId: string; delta: string }
  | {
      type: 'user-question-asked'
      sequence: number
      runId: string
      question: AgentUserQuestion
    }
  | {
      type: 'user-question-answered'
      sequence: number
      runId: string
      questionId: string
      answers: AgentUserQuestionAnswerItem[]
    }
  | { type: 'user-question-skipped'; sequence: number; runId: string; questionId: string }
  | ({ type: 'context-budget'; sequence: number; runId: string } & AgentContextBudgetState)
  | {
      type: 'context-compressed'
      sequence: number
      runId: string
      level: Exclude<AgentContextCompressionLevel, 'none'>
      notes: string[]
      summaryId?: string
      revision?: number
      coveredThroughSequence?: number
    }
  | { type: 'message-end'; sequence: number; runId: string; messageId: string }
  | {
      type: 'tool-call'
      sequence: number
      runId: string
      messageId: string
      toolCallId: string
      toolName: string
      args: Record<string, unknown>
    }
  | {
      type: 'tool-status'
      sequence: number
      runId: string
      toolCallId: string
      toolName: string
      status: AgentToolCallStatus
    }
  | {
      type: 'tool-progress'
      sequence: number
      runId: string
      toolCallId: string
      toolName: string
      content: string
      details?: Record<string, unknown>
    }
  | {
      type: 'tool-result'
      sequence: number
      runId: string
      toolCallId: string
      toolName: string
      status: AgentToolCallStatus
      isError: boolean
      summary: string
      audit?: Record<string, unknown>
    }
  | {
      type: 'skill-activation'
      sequence: number
      runId: string
      status: AgentSkillActivationStatus
      source: 'manual' | 'model'
      skillId: string
      skillName: string
      /** 成功激活时记录实际下载并校验过的当前包哈希。 */
      packageSha256?: string
      error?: AgentExecutionError
    }
  | {
      type: 'shell-execution'
      sequence: number
      runId: string
      toolCallId: string
      status: AgentToolCallStatus
      sandboxId: string
      command: string
      workingDirectory: string
      exitCode: number | null
      durationMs: number | null
      stdout?: AgentShellOutput
      stderr?: AgentShellOutput
      limitReason: AgentSandboxLimitReason | null
      error?: AgentExecutionError
    }
  | {
      type: 'file-operation'
      sequence: number
      runId: string
      toolCallId: string
      status: AgentToolCallStatus
      operation: AgentFileOperation
      direction: 'input' | 'output' | 'internal'
      /** OSS 中的稳定逻辑文件 ID；内部临时文件可省略。 */
      fileId?: string
      path: string
      size: number | null
      sha256?: string
      error?: AgentExecutionError
    }
  | { type: 'usage'; sequence: number; runId: string; usage: AgentRunUsage }
  | { type: 'error'; sequence: number; runId: string; error: GatewayError }

export const AGENT_EVENT_SSE_DONE = '[DONE]' as const
