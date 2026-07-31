export type AgentToolActivityState =
  'loading' | 'running' | 'success' | 'failed' | 'cancelled' | 'limit'

export function resolveAgentToolActivityState(input: {
  loading?: boolean | undefined
  running?: boolean | undefined
  status?: string | undefined
  isError?: boolean | undefined
  audit?: Record<string, unknown> | undefined
}): AgentToolActivityState {
  if (input.loading) return 'loading'
  if (input.running) return 'running'
  if (
    input.audit?.limitReason ||
    (typeof input.audit?.code === 'string' && input.audit.code.includes('LIMIT'))
  ) {
    return 'limit'
  }
  if (input.status === 'cancelled') return 'cancelled'
  if (input.isError || input.status === 'failed') return 'failed'
  return 'success'
}

export const AGENT_TOOL_ACTIVITY_LABELS: Record<AgentToolActivityState, string> = {
  loading: '准备中',
  running: '运行中',
  success: '已完成',
  failed: '失败',
  cancelled: '已取消',
  limit: '达到限制',
}
