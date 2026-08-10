/**
 * 平台中立的 Agent 工具契约。
 *
 * 工具实现不依赖 Pi 运行时类型；由 registry + converter 暴露给 Pi harness。模型提供的
 * 工具名或参数只能选择已注册工具，不能选择任意代码、端点、请求头或凭证。
 */
export interface AgentToolContext {
  toolCallId: string
  signal: AbortSignal
  /** Run-scoped tools require both values; generic tools may ignore them. */
  runId?: string
  userId?: string
  /** 报告执行中的进度/状态（可选，用于 UI 与事件流）。 */
  onProgress?: (progress: string | { content: string; details?: Record<string, unknown> }) => void
}

export interface AgentToolResult {
  /** 返回给模型的文本内容（受长度限制后的正文）。 */
  content: string
  /** 面向 UI/日志的简短摘要。 */
  summary: string
  isError: boolean
  /** 工具无关的审计投影（如 web_fetch 的 URL/状态/字节数）。禁止包含凭证或敏感响应头。 */
  audit?: Record<string, unknown>
}

export type AgentToolRiskLevel = 'read' | 'write' | 'external_send' | 'destructive'
export type AgentToolApprovalPolicy = 'none' | 'explicit'

export interface AgentToolDefinition<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string
  description: string
  /** UI 展示用标签。 */
  label: string
  riskLevel: AgentToolRiskLevel
  approvalPolicy: AgentToolApprovalPolicy
  /** JSON Schema 参数定义。 */
  parameters: Record<string, unknown>
  execute(args: TArgs, context: AgentToolContext): Promise<AgentToolResult>
}

export class AgentToolExecutionError extends Error {
  readonly summary: string
  readonly audit: Record<string, unknown> | undefined
  readonly code: string
  readonly retryable: boolean

  constructor(options: {
    code: string
    message: string
    summary?: string
    retryable?: boolean
    audit?: Record<string, unknown>
    cause?: unknown
  }) {
    super(sanitizeToolErrorMessage(options.message))
    this.name = 'AgentToolExecutionError'
    this.code = options.code
    this.summary = sanitizeToolErrorMessage(options.summary ?? options.message, 500)
    this.retryable = options.retryable ?? false
    this.audit = options.audit === undefined ? undefined : sanitizeToolAudit(options.audit)
    if (options.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        configurable: true,
        writable: true,
        enumerable: false,
      })
    }
  }
}

const SECRET_FIELD_PATTERN =
  /^(?:authorization|cookie|set-cookie|proxy-authorization|x-api-key|api-key|apikey|token|access_token|refresh_token|secret|password|privatekey|private_key)$/i
const MAX_ERROR_MESSAGE_CHARS = 4_000
const MAX_AUDIT_DEPTH = 4
const MAX_AUDIT_KEYS = 50
const MAX_AUDIT_ARRAY_ITEMS = 20
const MAX_AUDIT_STRING_CHARS = 1_000

/** 模型可见错误文本的统一脱敏与限长边界。 */
export function sanitizeToolErrorMessage(
  value: string,
  maxChars: number = MAX_ERROR_MESSAGE_CHARS,
): string {
  const redacted = value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(
      /([?&](?:access_token|refresh_token|token|api_key|apikey|password|secret)=)[^&#\s]*/gi,
      '$1[REDACTED]',
    )
    .replace(
      /((?:authorization|cookie|x-api-key|api-key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
  return redacted.length <= maxChars ? redacted : `${redacted.slice(0, maxChars)}…[truncated]`
}

/** 审计字段允许业务扩展，但递归过滤敏感键并限制体积。 */
export function sanitizeToolAudit(input: Record<string, unknown>): Record<string, unknown> {
  return sanitizeAuditRecord(input, 0)
}

function sanitizeAuditRecord(
  input: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  if (depth >= MAX_AUDIT_DEPTH) return { truncated: true }
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input).slice(0, MAX_AUDIT_KEYS)) {
    if (SECRET_FIELD_PATTERN.test(key)) continue
    output[key] = sanitizeAuditValue(value, depth + 1)
  }
  if (Object.keys(input).length > MAX_AUDIT_KEYS) output.truncated = true
  return output
}

function sanitizeAuditValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return sanitizeToolErrorMessage(value, MAX_AUDIT_STRING_CHARS)
  if (Array.isArray(value)) {
    return value.slice(0, MAX_AUDIT_ARRAY_ITEMS).map((item) => sanitizeAuditValue(item, depth))
  }
  if (typeof value === 'object' && value !== null) {
    return sanitizeAuditRecord(value as Record<string, unknown>, depth)
  }
  return value
}
