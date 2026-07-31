import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { shouldStartNewThreadOnModelChange } from './agent-model-policy'

describe('shouldStartNewThreadOnModelChange', () => {
  it('starts a new thread when changing model inside an existing session', () => {
    assert.equal(shouldStartNewThreadOnModelChange('thread-1', 'qwen3.7-plus', 'glm-5.2'), true)
  })

  it('keeps the blank composer when only choosing a model for a new session', () => {
    assert.equal(shouldStartNewThreadOnModelChange(null, 'qwen3.7-plus', 'glm-5.2'), false)
  })

  it('does nothing when the same model is re-selected', () => {
    assert.equal(
      shouldStartNewThreadOnModelChange('thread-1', 'qwen3.7-plus', 'qwen3.7-plus'),
      false,
    )
  })
})
