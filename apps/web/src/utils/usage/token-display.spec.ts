import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatTokenValue } from './token-display'

describe('formatTokenValue', () => {
  it('uses raw, ten-thousand and hundred-million units at stable boundaries', () => {
    assert.equal(formatTokenValue(0), '0')
    assert.equal(formatTokenValue(9_999), '9,999')
    assert.equal(formatTokenValue(10_000), '1万')
    assert.equal(formatTokenValue(51_672), '5.17万')
    assert.equal(formatTokenValue(99_999_999), '10,000万')
    assert.equal(formatTokenValue(100_000_000), '1亿')
    assert.equal(formatTokenValue(1_235_000_000), '12.35亿')
  })
})
