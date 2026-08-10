import type { AgentStreamEvent } from '@supermind/sdk'

/** 从 Agent SSE 事件中提取有序 tool 名序列（按 tool-call 出现顺序）。 */
export function extractTrajectory(events: readonly AgentStreamEvent[]): string[] {
  return events
    .filter((event): event is Extract<AgentStreamEvent, { type: 'tool-call' }> => {
      return event.type === 'tool-call'
    })
    .map((event) => event.toolName)
}

/** 拼接全部 text-delta，作为最终助手文本的流式近似。 */
export function extractAssistantTextFromDeltas(events: readonly AgentStreamEvent[]): string {
  return events
    .filter((event): event is Extract<AgentStreamEvent, { type: 'text-delta' }> => {
      return event.type === 'text-delta'
    })
    .map((event) => event.delta)
    .join('')
}

/**
 * 期望序列是否为实际轨迹的有序子序列。
 * 允许实际序列包含额外工具；顺序颠倒或缺失则失败。
 */
export function isOrderedSubsequence(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  if (expected.length === 0) return true
  let cursor = 0
  for (const name of actual) {
    if (name === expected[cursor]) {
      cursor += 1
      if (cursor === expected.length) return true
    }
  }
  return false
}

export function readTerminalStatus(events: readonly AgentStreamEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'run-terminal' && 'status' in event) return event.status
  }
  return undefined
}

export function hasWaitingForUser(events: readonly AgentStreamEvent[]): boolean {
  return events.some((event) => event.type === 'user-question-asked')
}
