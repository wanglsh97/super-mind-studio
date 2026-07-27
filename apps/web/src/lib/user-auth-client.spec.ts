import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  getUserSession,
  githubLoginUrl,
  logoutUser,
  sanitizeUserReturnTo,
  UserAuthApiError,
  userLoginErrorMessage,
} from './user-auth-client'

describe('user auth login helpers', () => {
  it('allows only explicit same-origin capability paths', () => {
    assert.equal(sanitizeUserReturnTo('/image'), '/image')
    for (const unsafe of [
      'https://attacker.example',
      '//attacker.example',
      '/admin',
      '/chat',
      '/chat?next=x',
    ]) {
      assert.equal(sanitizeUserReturnTo(unsafe), '/agent')
    }
    assert.equal(sanitizeUserReturnTo(null), '/agent')
    assert.equal(sanitizeUserReturnTo('/chat/compare'), '/chat/compare')
    assert.equal(githubLoginUrl('/prompt'), '/api/v1/auth/github?returnTo=%2Fprompt')
  })

  it('maps callback errors without exposing provider details', () => {
    assert.match(userLoginErrorMessage('authorization_rejected'), /cancelled/)
    assert.match(userLoginErrorMessage('oauth_failed'), /could not finish/)
    assert.equal(userLoginErrorMessage(null), '')
  })
})

describe('user auth session client', () => {
  it('restores and revokes a same-origin HttpOnly-cookie session', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const mockFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), ...(init ? { init } : {}) })
      return Response.json(
        String(input).endsWith('/logout')
          ? { success: true }
          : { user: { id: 'user-1', githubId: '1', githubUsername: 'octocat' } },
      )
    }

    await getUserSession(mockFetch)
    await logoutUser(mockFetch)
    assert.deepEqual(
      calls.map(({ url, init }) => [url, init?.method, init?.credentials]),
      [
        ['/api/v1/auth/session', 'GET', 'same-origin'],
        ['/api/v1/auth/logout', 'POST', 'same-origin'],
      ],
    )
  })

  it('returns a typed 401 for protected-page redirection', async () => {
    await assert.rejects(
      () =>
        getUserSession(async () =>
          Response.json({ message: '用户会话无效或已过期' }, { status: 401 }),
        ),
      (error: unknown) => error instanceof UserAuthApiError && error.status === 401,
    )
  })
})
