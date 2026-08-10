import {
  latencyWithinThreshold,
  nonEmptyOutput,
  trajectoryOrderedSubsequence,
} from './evaluators'

import type { Example, Run } from 'langsmith/schemas'

function makeRun(outputs: Record<string, unknown>): Run {
  return { outputs } as unknown as Run
}

function makeExample(outputs?: Record<string, unknown>): Example {
  return { outputs } as unknown as Example
}

describe('nonEmptyOutput', () => {
  it('非空通过', () => {
    expect(nonEmptyOutput(makeRun({ content: 'ok' })).score).toBe(1)
  })

  it('空失败', () => {
    expect(nonEmptyOutput(makeRun({ content: '  ' })).score).toBe(0)
  })
})

describe('latencyWithinThreshold', () => {
  it('低于阈值通过', () => {
    expect(
      latencyWithinThreshold(makeRun({ latencyMs: 100 }), makeExample({ maxLatencyMs: 200 })).score,
    ).toBe(1)
  })

  it('超时失败', () => {
    expect(
      latencyWithinThreshold(makeRun({ latencyMs: 300 }), makeExample({ maxLatencyMs: 200 })).score,
    ).toBe(0)
  })
})

describe('trajectoryOrderedSubsequence', () => {
  it('子序列通过并带上 correlation ids', () => {
    const result = trajectoryOrderedSubsequence(
      makeRun({
        trajectory: ['web_search', 'shell', 'web_fetch'],
        runId: 'run-1',
        requestIds: ['req-1'],
      }),
      makeExample({ expectedTrajectory: ['web_search', 'web_fetch'] }),
    )
    expect(result.score).toBe(1)
    expect(result.comment).toContain('runId=run-1')
    expect(result.comment).toContain('requestIds=req-1')
  })

  it('顺序错误失败', () => {
    expect(
      trajectoryOrderedSubsequence(
        makeRun({ trajectory: ['web_fetch', 'web_search'] }),
        makeExample({ expectedTrajectory: ['web_search', 'web_fetch'] }),
      ).score,
    ).toBe(0)
  })

  it('target error 记失败', () => {
    expect(
      trajectoryOrderedSubsequence(makeRun({ error: 'timeout', trajectory: [] }), makeExample({})).score,
    ).toBe(0)
  })
})
