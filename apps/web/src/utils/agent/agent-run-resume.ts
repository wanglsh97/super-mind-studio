import type { AgentMessage, AgentRunSummary, AgentStreamEvent } from '@supermind/sdk'

import {
  initialAgentRunViewState,
  reduceAgentEvent,
  type AgentRunViewState,
} from './agent-run-reducer'

/**
 * 用事件流重建视图，并从 `after` 游标起忽略已见 sequence，避免刷新补读重复工具卡片。
 */
export function foldEventsFromCursor(
  events: readonly AgentStreamEvent[],
  afterSequence: number,
  seed: AgentRunViewState = initialAgentRunViewState(),
): AgentRunViewState {
  let state = seed
  for (const event of events) {
    if (event.sequence <= afterSequence) continue
    state = reduceAgentEvent(state, event)
  }
  return state
}

/** 把历史 thread 消息与恢复中的 run 视图合并为完整消息列表（用户消息在前）。 */
export function mergeThreadMessagesWithRunView(
  history: readonly AgentMessage[],
  view: AgentRunViewState,
): AgentMessage[] {
  const historyWithoutTrailingAssistant = [...history]
  while (historyWithoutTrailingAssistant.at(-1)?.role === 'assistant') {
    historyWithoutTrailingAssistant.pop()
  }
  while (historyWithoutTrailingAssistant.at(-1)?.role === 'tool') {
    historyWithoutTrailingAssistant.pop()
  }
  return [...historyWithoutTrailingAssistant, ...view.messages]
}

export function isResumableActiveRun(
  activeRun: AgentRunSummary | null | undefined,
): activeRun is AgentRunSummary {
  return (
    activeRun != null &&
    (activeRun.status === 'running' ||
      activeRun.status === 'cancelling' ||
      activeRun.status === 'waiting_for_user')
  )
}
