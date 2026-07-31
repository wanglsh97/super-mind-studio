import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { loadAdminTableRows, loadAdminTables, loadAdminTableSchema } from './admin-tables'

describe('admin table client', () => {
  it('loads capabilities and encoded paginated rows with same-origin credentials', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImplementation: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
      return Response.json([])
    }

    await loadAdminTables(fetchImplementation)
    await loadAdminTableRows('request/logs', { page: 2, pageSize: 20 }, fetchImplementation)

    assert.equal(calls[0]?.url, '/api/v1/admin/tables')
    assert.equal(calls[1]?.url, '/api/v1/admin/tables/request%2Flogs/rows?page=2&pageSize=20')
    assert.ok(calls.every(({ init }) => init?.credentials === 'same-origin'))
  })

  it('loads schema for read-only table browser', async () => {
    const fetchImplementation: typeof fetch = async () =>
      Response.json({ tables: [], relations: [] })

    const schema = await loadAdminTableSchema(fetchImplementation)

    assert.deepEqual(schema, { tables: [], relations: [] })
  })

  it('exposes tables as query-only capabilities', async () => {
    const fetchImplementation: typeof fetch = async () =>
      Response.json([
        {
          name: 'admin-audit-logs',
          physicalName: 'AdminAuditLog',
          label: '管理员操作审计',
          primaryKey: 'id',
          operations: ['query'],
          fields: [],
          relations: [],
        },
      ])

    const capabilities = await loadAdminTables(fetchImplementation)

    assert.deepEqual(capabilities[0]?.operations, ['query'])
    assert.equal(capabilities[0]?.name, 'admin-audit-logs')
  })
})
