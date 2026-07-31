'use client'

import type { AgentRunProgressStage } from '@/utils/agent/agent-run-adapter'

const STAGE_COPY: Record<AgentRunProgressStage, string> = {
  'creating-thread': '正在创建会话…',
  'starting-run': '正在提交任务…',
  'preparing-sandbox': '正在准备执行环境…',
  thinking: '正在思考…',
}

export function AgentRunProgressIndicator({ stage }: Readonly<{ stage: AgentRunProgressStage | null }>) {
  if (!stage) return null

  return (
    <div className="flex items-center gap-2 py-4 text-sm text-ink-muted" role="status" aria-live="polite">
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-brand" />
      {STAGE_COPY[stage]}
    </div>
  )
}
