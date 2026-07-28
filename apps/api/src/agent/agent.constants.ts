export const AGENT_THREAD_TITLE_MAX_LENGTH = 200

export const AGENT_DEFAULT_THREAD_TITLE = '新的 Agent 会话'

/** 默认标题从用户首个输入截断而来的最大字符数。 */
export const AGENT_DERIVED_TITLE_MAX_LENGTH = 60

export const AGENT_THREAD_LIST_DEFAULT_PAGE = 1
export const AGENT_THREAD_LIST_DEFAULT_PAGE_SIZE = 50
export const AGENT_THREAD_LIST_MAX_PAGE_SIZE = 100

/**
 * 用户级 active run Redis 锁 TTL（秒）。
 * 略大于默认 run 时长预算（120s），启动清理（2.7）会处理过期遗留。
 */
export const AGENT_ACTIVE_RUN_LOCK_TTL_SECONDS = 180

export function agentActiveRunLockKey(threadId: string): string {
  return `agent:active-run:thread:${threadId}`
}
