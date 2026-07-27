import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'

import type { GitHubOAuthClient } from './github-oauth.client'
import { OAuthStateService } from './oauth-state.service'
import { OAUTH_STATE_COOKIE, USER_SESSION_COOKIE } from './user-auth.constants'
import { UserAuthController } from './user-auth.controller'
import type { UserSessionService } from './user-session.service'

function setup() {
  const state = new OAuthStateService('fixture-user-session-secret-with-at-least-32-characters')
  const authenticate = jest.fn().mockResolvedValue({
    githubId: '12345678',
    githubUsername: 'octocat',
    displayName: 'The Octocat',
    avatarUrl: null,
    email: null,
  })
  const create = jest.fn().mockResolvedValue({
    token: 'session-token',
    expiresAt: new Date('2026-08-18T00:00:00.000Z'),
    user: { id: 'user-id', githubId: '12345678', githubUsername: 'octocat' },
  })
  const read = jest.fn().mockResolvedValue({
    id: 'user-id',
    githubId: '12345678',
    githubUsername: 'octocat',
  })
  const revoke = jest.fn().mockResolvedValue(undefined)
  const controller = new UserAuthController(
    { authenticate } as unknown as GitHubOAuthClient,
    state,
    { create, read, revoke } as unknown as UserSessionService,
    new ConfigService({
      GITHUB_OAUTH_ENABLED: true,
      GITHUB_CLIENT_ID: 'fixture-client-id',
      GITHUB_CALLBACK_URL: 'http://localhost:3001/api/v1/auth/github/callback',
      WEB_ORIGIN: 'http://localhost:3000',
      USER_SESSION_TTL_SECONDS: 2_592_000,
      NODE_ENV: 'test',
    }),
  )
  return { authenticate, controller, create, read, revoke }
}

function responseDouble() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
  } as unknown as Response
}

describe('UserAuthController', () => {
  it('starts GitHub authorization with state, email scope, and a safe return path', () => {
    const { controller } = setup()
    const response = responseDouble()

    controller.beginGitHubLogin('/', response)

    expect(response.cookie).toHaveBeenCalledWith(
      OAUTH_STATE_COOKIE,
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', maxAge: 600_000 }),
    )
    const redirect = (response.redirect as jest.Mock).mock.calls[0]?.[1] as string
    const url = new URL(redirect)
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('scope')).toBe('read:user user:email')
    expect(url.searchParams.get('state')).toBeTruthy()
  })

  it('consumes state, creates a database session, and redirects on successful callback', async () => {
    const { authenticate, controller, create } = setup()
    const beginResponse = responseDouble()
    controller.beginGitHubLogin('/', beginResponse)
    const stateCookie = (beginResponse.cookie as jest.Mock).mock.calls[0]?.[1] as string
    const authorizeUrl = new URL((beginResponse.redirect as jest.Mock).mock.calls[0]?.[1] as string)
    const response = responseDouble()

    await controller.completeGitHubLogin(
      'one-time-code',
      authorizeUrl.searchParams.get('state') ?? undefined,
      undefined,
      { cookies: { [OAUTH_STATE_COOKIE]: stateCookie } } as unknown as Request,
      response,
    )

    expect(response.clearCookie).toHaveBeenCalledWith(
      OAUTH_STATE_COOKIE,
      expect.not.objectContaining({ maxAge: expect.anything() }),
    )
    expect(authenticate).toHaveBeenCalledWith('one-time-code')
    expect(create).toHaveBeenCalledTimes(1)
    expect(response.cookie).toHaveBeenCalledWith(
      USER_SESSION_COOKIE,
      'session-token',
      expect.objectContaining({ httpOnly: true, path: '/api/v1', maxAge: 2_592_000_000 }),
    )
    expect(response.redirect).toHaveBeenCalledWith(302, 'http://localhost:3000/')
  })

  it('does not call GitHub when state is invalid or replayed', async () => {
    const { authenticate, controller } = setup()
    const response = responseDouble()

    await controller.completeGitHubLogin(
      'one-time-code',
      'forged-state',
      undefined,
      { cookies: {} } as unknown as Request,
      response,
    )

    expect(authenticate).not.toHaveBeenCalled()
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'http://localhost:3000/login?error=oauth_failed&returnTo=%2F',
    )
  })

  it('reads and revokes only the current cookie session', async () => {
    const { controller, read, revoke } = setup()
    const request = { cookies: { [USER_SESSION_COOKIE]: 'current-token' } } as unknown as Request
    const response = responseDouble()

    await expect(controller.readSession(request)).resolves.toMatchObject({
      user: { githubUsername: 'octocat' },
    })
    await expect(controller.logout(request, response)).resolves.toEqual({ success: true })
    expect(read).toHaveBeenCalledWith('current-token')
    expect(revoke).toHaveBeenCalledWith('current-token')
    expect(response.clearCookie).toHaveBeenCalledWith(
      USER_SESSION_COOKIE,
      expect.not.objectContaining({ maxAge: expect.anything() }),
    )
  })
})
