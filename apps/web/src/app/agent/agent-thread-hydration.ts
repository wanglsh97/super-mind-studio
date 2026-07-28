import type { ThreadMessageLike } from '@assistant-ui/react'

interface HydratableThreadRuntime {
  getState: () => { isRunning: boolean }
  reset: (messages: ThreadMessageLike[]) => void
}

/**
 * LocalRuntime 生成中不能替换消息仓库，否则流式 assistant 消息仍持有的 parentId
 * 会指向已被 reset 清除的 user 消息。
 */
export function resetThreadIfIdle(
  runtime: HydratableThreadRuntime,
  messages: readonly ThreadMessageLike[],
): boolean {
  if (runtime.getState().isRunning) return false
  runtime.reset([...messages])
  return true
}
