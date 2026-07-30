import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { tokenHeatLevel } from './token-calendar-heatmap'

describe('tokenHeatLevel', () => {
  it('maps exact fixed token boundaries to stable heat levels', () => {
    assert.equal(tokenHeatLevel(0), 0)
    assert.equal(tokenHeatLevel(1), 1)
    assert.equal(tokenHeatLevel(49_999_999), 1)
    assert.equal(tokenHeatLevel(50_000_000), 2)
    assert.equal(tokenHeatLevel(99_999_999), 2)
    assert.equal(tokenHeatLevel(100_000_000), 3)
    assert.equal(tokenHeatLevel(999_999_999), 3)
    assert.equal(tokenHeatLevel(1_000_000_000), 4)
  })
})
