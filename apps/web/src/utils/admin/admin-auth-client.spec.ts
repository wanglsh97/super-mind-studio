import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AdminApiError, getAdminSession, loginAdmin, logoutAdmin } from './admin-auth-client'

describe('admin auth client', () => {
  it('uses same-origin credentials for login, session restore and logout', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImplementation: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
      if (String(input).endsWith('/logout')) return Response.json({ success: true })
      return Response.json({ username: 'root', expiresAt: '2026-07-17T12:00:00.000Z' })
    }

    await loginAdmin('root', '123456', fetchImplementation)
    await getAdminSession(fetchImplementation)
    await logoutAdmin(fetchImplementation)

    assert.deepEqual(
      calls.map(({ url }) => url),
      ['/api/v1/admin/auth/login', '/api/v1/admin/auth/session', '/api/v1/admin/auth/logout'],
    )
    assert.ok(calls.every(({ init }) => init?.credentials === 'same-origin'))
  })

  it('surfaces 401 as a typed error for route redirection', async () => {
    await assert.rejects(
      () =>
        getAdminSession(async () =>
          Response.json({ message: '管理员会话无效或已过期' }, { status: 401 }),
        ),
      (error: unknown) => error instanceof AdminApiError && error.status === 401,
    )
  })
})
