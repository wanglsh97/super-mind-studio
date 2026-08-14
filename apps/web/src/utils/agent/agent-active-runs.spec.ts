import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { AgentRunSummary } from '@supermind/sdk'

import { activeRunForThread, removeActiveRun, upsertActiveRun } from './agent-active-runs'

function run(
  id: string,
  threadId: string,
  status: AgentRunSummary['status'] = 'running',
): AgentRunSummary {
  return {
    id,
    threadId,
    model: 'qwen3.7-plus',
    provider: 'qwen',
    status,
    limitReason: null,
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      usageUnknown: true,
      estimatedCostCny: null,
      modelCalls: 0,
      toolCalls: 0,
      webFetchCalls: 0,
    },
    lastSequence: -1,
    createdAt: '',
    startedAt: null,
    completedAt: null,
  }
}

describe('Agent active runs by Thread', () => {
  it('keeps runs from different Threads and replaces only the matching Thread', () => {
    const initial = [run('run-a', 'thread-a')]
    const concurrent = upsertActiveRun(initial, run('run-b', 'thread-b'))
    const cancelling = upsertActiveRun(concurrent, run('run-a', 'thread-a', 'cancelling'))

    assert.deepEqual(
      cancelling.map((item) => [item.id, item.status]),
      [
        ['run-a', 'cancelling'],
        ['run-b', 'running'],
      ],
    )
    assert.equal(activeRunForThread(cancelling, 'thread-b')?.id, 'run-b')
  })

  it('removes only the completed Thread run', () => {
    const concurrent = [run('run-a', 'thread-a'), run('run-b', 'thread-b')]
    assert.deepEqual(
      removeActiveRun(concurrent, 'thread-a').map((item) => item.id),
      ['run-b'],
    )
    assert.deepEqual(upsertActiveRun(concurrent, run('run-a', 'thread-a', 'succeeded')), [
      run('run-b', 'thread-b'),
    ])
  })

  it('keeps a run active while it is waiting for a user answer', () => {
    const waiting = run('run-waiting', 'thread-a', 'waiting_for_user')

    assert.deepEqual(upsertActiveRun([], waiting), [waiting])
    assert.equal(activeRunForThread([waiting], 'thread-a')?.id, 'run-waiting')
  })
})
