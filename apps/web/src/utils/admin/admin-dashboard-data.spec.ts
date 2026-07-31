import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { loadDashboard } from './admin-dashboard-data'

describe('loadDashboard', () => {
  it('keeps successful sections when one dashboard request fails', async () => {
    const result = await loadDashboard(async (input) => {
      const url = String(input)
      if (url.endsWith('/trends'))
        return Response.json({ message: '趋势暂不可用' }, { status: 503 })
      if (url.endsWith('/overview')) {
        return Response.json({
          requestCount: 0,
          successRate: null,
          estimatedCostCny: '0.00000000',
          health: [],
          generatedAt: 'now',
        })
      }
      return Response.json([])
    })

    assert.equal(result.overview.status, 'success')
    assert.deepEqual(result.trends, {
      status: 'error',
      message: '趋势暂不可用',
      unauthorized: false,
    })
    assert.equal(result.latencies.status, 'success')
    assert.equal(result.errors.status, 'success')
  })

  it('marks only 401 failures as unauthorized for redirect handling', async () => {
    const result = await loadDashboard(async () => Response.json({}, { status: 401 }))

    assert.ok(
      Object.values(result).every((section) => section.status === 'error' && section.unauthorized),
    )
  })
})
