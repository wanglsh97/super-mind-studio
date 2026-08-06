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

export interface AgentToolDetailLabels {
  subject: string
  detail: string
  summary: string
  audit: string
}

export function agentToolDetailLabels(toolName: string): AgentToolDetailLabels {
  switch (toolName) {
    case 'shell':
      return { subject: '命令', detail: '工作目录', summary: '执行摘要', audit: '运行数据' }
    case 'read_file':
      return { subject: '文件', detail: '读取范围', summary: '读取摘要', audit: '文件信息' }
    case 'write_file':
      return { subject: '文件', detail: '写入方式', summary: '写入摘要', audit: '文件信息' }
    case 'export_file':
      return { subject: '文件', detail: '导出位置', summary: '导出摘要', audit: '产物信息' }
    case 'create_website':
      return { subject: '任务', detail: '构建配置', summary: '构建摘要', audit: '交付信息' }
    case 'web_fetch':
      return { subject: '网址', detail: '响应状态', summary: '响应摘要', audit: '响应信息' }
    default:
      return { subject: '服务', detail: '调用上下文', summary: '调用摘要', audit: '调用数据' }
  }
}
