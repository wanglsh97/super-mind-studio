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
  onProgress?: (summary: string) => void
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

  constructor(options: {
    code: string
    message: string
    summary?: string
    audit?: Record<string, unknown>
  }) {
    super(options.message)
    this.name = 'AgentToolExecutionError'
    this.code = options.code
    this.summary = options.summary ?? options.message
    this.audit = options.audit
  }
}
