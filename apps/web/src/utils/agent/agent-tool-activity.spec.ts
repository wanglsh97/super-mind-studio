import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveAgentToolActivityState } from './agent-tool-activity'

describe('resolveAgentToolActivityState', () => {
  it('covers loading, running, success, failed, cancelled and limit states', () => {
    assert.equal(resolveAgentToolActivityState({ loading: true }), 'loading')
    assert.equal(resolveAgentToolActivityState({ running: true }), 'running')
    assert.equal(resolveAgentToolActivityState({ status: 'succeeded' }), 'success')
    assert.equal(resolveAgentToolActivityState({ status: 'failed', isError: true }), 'failed')
    assert.equal(resolveAgentToolActivityState({ status: 'cancelled' }), 'cancelled')
    assert.equal(
      resolveAgentToolActivityState({
        status: 'failed',
        audit: { limitReason: 'shell_calls' },
      }),
      'limit',
    )
  })
})
