import type { AgentRunSummary } from '@supermind/sdk'

export function activeRunForThread(
  runs: readonly AgentRunSummary[],
  threadId: string | null | undefined,
): AgentRunSummary | null {
  if (!threadId) return null
  return runs.find((run) => run.threadId === threadId) ?? null
}

export function upsertActiveRun(
  runs: readonly AgentRunSummary[],
  run: AgentRunSummary,
): AgentRunSummary[] {
  if (run.status !== 'running' && run.status !== 'cancelling') {
    return removeActiveRun(runs, run.threadId)
  }
  return [run, ...runs.filter((current) => current.threadId !== run.threadId)]
}

export function removeActiveRun(
  runs: readonly AgentRunSummary[],
  threadId: string,
): AgentRunSummary[] {
  return runs.filter((run) => run.threadId !== threadId)
}
