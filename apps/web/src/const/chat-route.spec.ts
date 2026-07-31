import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CHAT_ROUTE_DESTINATION } from '@/const/chat-route'
import { sanitizeUserReturnTo } from '@/utils/auth/user-auth-client'

describe('retired Chat route policy', () => {
  it('uses Agent as the canonical ordinary conversation destination', () => {
    assert.equal(CHAT_ROUTE_DESTINATION, '/')
    assert.equal(sanitizeUserReturnTo('/chat'), '/')
    assert.equal(sanitizeUserReturnTo(null), CHAT_ROUTE_DESTINATION)
  })
})
