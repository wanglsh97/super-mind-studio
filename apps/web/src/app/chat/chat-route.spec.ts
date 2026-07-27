import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { sanitizeUserReturnTo } from '../../lib/user-auth-client'
import { CHAT_ROUTE_DESTINATION } from './chat-route'

describe('retired Chat route policy', () => {
  it('uses Agent as the canonical ordinary conversation destination', () => {
    assert.equal(CHAT_ROUTE_DESTINATION, '/')
    assert.equal(sanitizeUserReturnTo('/chat'), '/')
    assert.equal(sanitizeUserReturnTo(null), CHAT_ROUTE_DESTINATION)
  })

  it('keeps multi-model comparison as an allowed Agent sub-scenario', () => {
    assert.equal(sanitizeUserReturnTo('/chat/compare'), '/chat/compare')
  })
})
