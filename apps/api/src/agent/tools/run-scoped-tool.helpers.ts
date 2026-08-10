import { AgentToolExecutionError, type AgentToolContext } from './agent-tool'

export function requireRunScope(context: AgentToolContext): { runId: string; userId: string } {
  if (!context.runId || !context.userId) {
    throw new AgentToolExecutionError({
      code: 'AGENT_TOOL_SCOPE_REQUIRED',
      message: '工具缺少当前 Agent Run 的执行范围，无法安全执行。请重新开始任务后再试。',
      summary: '工具执行范围缺失',
      retryable: false,
    })
  }
  return { runId: context.runId, userId: context.userId }
}

export function createToolErrorResult(error: unknown, summary: string): never {
  if (error instanceof AgentToolExecutionError) throw error
  const normalized = normalizeError(error)
  throw new AgentToolExecutionError({
    code: normalized.code,
    message: `${normalized.message}。请检查工具输入、执行环境或前置条件后再决定是否重试。`,
    summary,
    retryable: normalized.retryable,
    audit: {
      code: normalized.code,
      retryable: normalized.retryable,
      ...(normalized.details === undefined ? {} : normalized.details),
    },
    cause: error,
  })
}

function normalizeError(error: unknown): {
  code: string
  message: string
  retryable: boolean
  details?: Record<string, unknown>
} {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  ) {
    return {
      code: error.code,
      message: error.message,
      retryable: 'retryable' in error && error.retryable === true,
      ...('details' in error && typeof error.details === 'object' && error.details !== null
        ? { details: error.details as Record<string, unknown> }
        : {}),
    }
  }
  return {
    code: 'SANDBOX_UNAVAILABLE',
    message: error instanceof Error ? error.message : 'Sandbox 工具执行失败',
    retryable: true,
  }
}
