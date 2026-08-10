import type { EvaluationResult } from 'langsmith/evaluation'
import type { Example, Run } from 'langsmith/schemas'

import { isOrderedSubsequence } from './web-agent/extract-run'

interface EvalOutputs {
  content?: unknown
  latencyMs?: unknown
  trajectory?: unknown
  error?: unknown
  runId?: unknown
  requestIds?: unknown
}

function readOutputs(run: Run): EvalOutputs {
  return (run.outputs ?? {}) as EvalOutputs
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 输出非空。 */
export function nonEmptyOutput(run: Run): EvaluationResult {
  const pass = asString(readOutputs(run).content).trim().length > 0
  return {
    key: 'non_empty_output',
    score: pass ? 1 : 0,
    ...(pass ? {} : { comment: '输出为空' }),
  }
}

/** 延迟不超过阈值（默认 general 180s，可用 example.outputs.maxLatencyMs 覆盖）。 */
export function latencyWithinThreshold(run: Run, example?: Example): EvaluationResult {
  const latencyMs = asNumber(readOutputs(run).latencyMs)
  const exampleOutputs = (example?.outputs ?? {}) as { maxLatencyMs?: unknown }
  const threshold = asNumber(exampleOutputs.maxLatencyMs) ?? 180_000
  if (latencyMs === undefined) {
    return { key: 'latency_within_threshold', score: 0, comment: '目标未上报 latencyMs' }
  }
  const pass = latencyMs <= threshold
  return {
    key: 'latency_within_threshold',
    score: pass ? 1 : 0,
    comment: `latency=${latencyMs}ms, threshold=${threshold}ms`,
  }
}

/** L3：期望轨迹为实际轨迹的有序子序列。 */
export function trajectoryOrderedSubsequence(run: Run, example?: Example): EvaluationResult {
  const outputs = readOutputs(run)
  if (asString(outputs.error).length > 0) {
    return {
      key: 'trajectory_ordered_subsequence',
      score: 0,
      comment: `run error: ${asString(outputs.error)}`,
    }
  }
  const actual = asStringArray(outputs.trajectory)
  const exampleOutputs = (example?.outputs ?? {}) as { expectedTrajectory?: unknown }
  const expected = asStringArray(exampleOutputs.expectedTrajectory)
  const pass = isOrderedSubsequence(actual, expected)
  const correlation = [
    asString(outputs.runId) ? `runId=${asString(outputs.runId)}` : '',
    asStringArray(outputs.requestIds).length > 0
      ? `requestIds=${asStringArray(outputs.requestIds).join(',')}`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
  return {
    key: 'trajectory_ordered_subsequence',
    score: pass ? 1 : 0,
    comment: [
      `expected=[${expected.join(', ')}]`,
      `actual=[${actual.join(', ')}]`,
      correlation,
    ]
      .filter(Boolean)
      .join('; '),
  }
}

export const agentEvalDeterministicEvaluators = [
  nonEmptyOutput,
  latencyWithinThreshold,
  trajectoryOrderedSubsequence,
]
