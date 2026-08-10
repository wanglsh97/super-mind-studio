import type { AgentExecutionError } from '@supermind/sdk'

import { AgentToolExecutionError, type AgentToolContext } from './agent-tool'

export function requireRunScope(context: AgentToolContext): { runId: string; userId: string } {
  if (!context.runId || !context.userId) throw new Error('Run-scoped tool context is missing')
  return { runId: context.runId, userId: context.userId }
}

export function createToolErrorResult(error: unknown, summary: string): never {
  const normalized = normalizeError(error)
  throw new AgentToolExecutionError({
    code: normalized.code,
    message: normalized.message,
    summary,
    retryable: normalized.retryable,
    audit: { code: normalized.code, retryable: normalized.retryable },
  })
}

function normalizeError(error: unknown): AgentExecutionError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  ) {
    return {
      code: error.code as AgentExecutionError['code'],
      message: error.message,
      retryable: 'retryable' in error && error.retryable === true,
    }
  }
  return {
    code: 'SANDBOX_UNAVAILABLE',
    message: error instanceof Error ? error.message : 'Sandbox 工具执行失败',
    retryable: false,
  }
}
