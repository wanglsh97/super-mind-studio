import type { AgentStreamEvent } from '@supermind/sdk'

import type { EvalSuite } from '../langsmith-eval.config'
import type { AgentEvalHarness } from './harness'
import {
  extractAssistantTextFromDeltas,
  extractTrajectory,
  hasWaitingForUser,
  readTerminalStatus,
} from './extract-run'

export interface WebAgentTargetInput {
  prompt: string
  expectedTrajectory?: string[]
}

export interface WebAgentTargetOutput {
  content: string
  trajectory: string[]
  latencyMs: number
  runId: string
  requestIds: string[]
  terminalStatus?: string | undefined
  error?: string | undefined
}

export function createWebAgentTarget(
  harness: AgentEvalHarness,
  options: { suite: EvalSuite; timeoutMs: number },
): (input: WebAgentTargetInput) => Promise<WebAgentTargetOutput> {
  return async (input) => {
    const startedAt = performance.now()
    const thread = await harness.client.agent.threads.create({ model: harness.modelId })
    let runId = ''
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs)

    try {
      const run = await harness.client.agent.runs.create(thread.id, {
        input: input.prompt,
        ...(options.suite === 'website' ? { mode: 'website' as const } : {}),
        thinkingEffort: 'fast',
      })
      runId = run.id

      const events: AgentStreamEvent[] = []
      try {
        for await (const event of harness.client.agent.runs.subscribe(run.id, {
          signal: controller.signal,
        })) {
          events.push(event)
          if (event.type === 'run-terminal') break
        }
      } catch (error) {
        if (controller.signal.aborted) {
          await bestEffortCancel(harness, run.id)
          const requestIds = await loadRequestIds(harness, run.id)
          const timedOut: WebAgentTargetOutput = {
            content: extractAssistantTextFromDeltas(events),
            trajectory: extractTrajectory(events),
            latencyMs: Math.round(performance.now() - startedAt),
            runId: run.id,
            requestIds,
            error: hasWaitingForUser(events) ? 'timeout_waiting_for_user' : 'timeout',
          }
          const status = readTerminalStatus(events)
          if (status !== undefined) timedOut.terminalStatus = status
          return timedOut
        }
        throw error
      }

      const requestIds = await loadRequestIds(harness, run.id)
      const terminalStatus = readTerminalStatus(events)
      const content = extractAssistantTextFromDeltas(events)
      const trajectory = extractTrajectory(events)
      const failed =
        terminalStatus &&
        terminalStatus !== 'succeeded' &&
        terminalStatus !== 'limit_reached'
          ? `terminal_status=${terminalStatus}`
          : undefined

      const output: WebAgentTargetOutput = {
        content,
        trajectory,
        latencyMs: Math.round(performance.now() - startedAt),
        runId: run.id,
        requestIds,
      }
      if (terminalStatus !== undefined) output.terminalStatus = terminalStatus
      if (failed !== undefined) output.error = failed
      return output
    } catch (error) {
      return {
        content: '',
        trajectory: [],
        latencyMs: Math.round(performance.now() - startedAt),
        runId,
        requestIds: runId ? await loadRequestIds(harness, runId) : [],
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      clearTimeout(timer)
      await bestEffortDeleteThread(harness, thread.id)
    }
  }
}

async function loadRequestIds(harness: AgentEvalHarness, runId: string): Promise<string[]> {
  try {
    const logs = await harness.prisma.requestLog.findMany({
      where: { agentRunId: runId },
      select: { requestId: true },
      orderBy: { createdAt: 'asc' },
    })
    return logs.map((log) => log.requestId)
  } catch {
    // 评测结果仍应保留 Agent run，即使诊断用的 RequestLog 查询暂时不可用。
    return []
  }
}

async function bestEffortCancel(harness: AgentEvalHarness, runId: string): Promise<void> {
  try {
    await harness.client.agent.runs.cancel(runId)
  } catch {
    // ignore
  }
}

async function bestEffortDeleteThread(harness: AgentEvalHarness, threadId: string): Promise<void> {
  try {
    await harness.client.agent.threads.delete(threadId)
  } catch {
    // ignore
  }
}
