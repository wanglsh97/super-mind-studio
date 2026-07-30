import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatTokenValue } from './token-display'

describe('formatTokenValue', () => {
  it('keeps values below ten thousand and formats larger values in ten-thousands', () => {
    assert.equal(formatTokenValue(0), '0')
    assert.equal(formatTokenValue(9_999), '9,999')
    assert.equal(formatTokenValue(10_000), '1万')
    assert.equal(formatTokenValue(51_672), '5.17万')
    assert.equal(formatTokenValue(100_000_000), '10,000万')
  })
})
