import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  AGENT_THREAD_PREVIEW_LIMIT,
  hiddenAgentThreadCount,
  visibleAgentThreads,
} from './agent-thread-list'

describe('Agent sidebar thread folding', () => {
  const threads = Array.from({ length: 8 }, (_, index) => `thread-${index + 1}`)

  it('shows the five most-recent threads by default', () => {
    assert.equal(AGENT_THREAD_PREVIEW_LIMIT, 5)
    assert.deepEqual(visibleAgentThreads(threads, false), threads.slice(0, 5))
    assert.equal(hiddenAgentThreadCount(threads, false), 3)
  })

  it('reveals every thread and removes the hidden count when expanded', () => {
    assert.deepEqual(visibleAgentThreads(threads, true), threads)
    assert.equal(hiddenAgentThreadCount(threads, true), 0)
  })
})
