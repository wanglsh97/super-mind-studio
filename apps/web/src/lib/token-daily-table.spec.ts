import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { paginateTokenDailyUsage } from './token-daily-table'

describe('paginateTokenDailyUsage', () => {
  it('sorts newest dates first and clamps pagination', () => {
    const rows = [
      { date: '2026-07-27', value: 1 },
      { date: '2026-07-29', value: 3 },
      { date: '2026-07-28', value: 2 },
    ]

    assert.deepEqual(paginateTokenDailyUsage(rows, 1, 2), {
      rows: [
        { date: '2026-07-29', value: 3 },
        { date: '2026-07-28', value: 2 },
      ],
      page: 1,
      totalPages: 2,
    })
    assert.deepEqual(paginateTokenDailyUsage(rows, 99, 2), {
      rows: [{ date: '2026-07-27', value: 1 }],
      page: 2,
      totalPages: 2,
    })
  })
})
