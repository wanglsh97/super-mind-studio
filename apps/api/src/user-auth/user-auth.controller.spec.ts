import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'

import type { GitHubOAuthClient } from './github-oauth.client'
import type { GoogleOAuthClient } from './google-oauth.client'
import { OAuthStateService } from './oauth-state.service'
import {
  GITHUB_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
  USER_SESSION_COOKIE,
} from './user-auth.constants'
import { UserAuthController } from './user-auth.controller'
import type { UserSessionService } from './user-session.service'

function setup(overrides: Record<string, string | number | boolean> = {}) {
  const state = new OAuthStateService('fixture-user-session-secret-with-at-least-32-characters')
  const authenticate = jest.fn().mockResolvedValue({
    authProvider: 'GITHUB',
    providerUserId: '12345678',
    userName: 'octocat',
    avatarUrl: null,
    email: null,
  })
  const authenticateGoogle = jest.fn().mockResolvedValue({
    authProvider: 'GOOGLE',
    providerUserId: 'google-subject',
    userName: 'Google User',
    avatarUrl: null,
    email: null,
  })
  const create = jest.fn(
    async (identity: { authProvider: string; providerUserId: string; userName: string }) => ({
      token: 'session-token',
      expiresAt: new Date('2026-08-18T00:00:00.000Z'),
      user: {
        id: 'user-id',
        authProvider: identity.authProvider,
        userName: identity.userName,
        avatarUrl: null,
      },
    }),
  )
  const read = jest.fn().mockResolvedValue({
    id: 'user-id',
    authProvider: 'GITHUB',
    userName: 'octocat',
  })
  const hasActiveSession = jest.fn().mockResolvedValue(false)
  const revoke = jest.fn().mockResolvedValue(undefined)
  const controller = new UserAuthController(
    { authenticate } as unknown as GitHubOAuthClient,
    { authenticate: authenticateGoogle } as unknown as GoogleOAuthClient,
    state,
    { create, hasActiveSession, read, revoke } as unknown as UserSessionService,
    new ConfigService({
      GITHUB_OAUTH_ENABLED: true,
      GITHUB_CLIENT_ID: 'fixture-client-id',
      GITHUB_CALLBACK_URL: 'http://localhost:3001/api/v1/auth/github/callback',
      GOOGLE_OAUTH_ENABLED: true,
      GOOGLE_CLIENT_ID: 'fixture-google-client-id',
      GOOGLE_CALLBACK_URL: 'http://localhost:3001/api/v1/auth/google/callback',
      WEB_ORIGIN: 'http://localhost:3000',
      USER_SESSION_TTL_SECONDS: 2_592_000,
      NODE_ENV: 'test',
      ...overrides,
    }),
  )
  return { authenticate, authenticateGoogle, controller, create, hasActiveSession, read, revoke }
}

function responseDouble() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
  } as unknown as Response
}

function loggedOutRequest() {
  return { cookies: {} } as unknown as Request
}

describe('UserAuthController', () => {
  it('starts GitHub authorization with state, email scope, and a safe return path', async () => {
    const { controller } = setup()
    const response = responseDouble()

    await controller.beginGitHubLogin('/', loggedOutRequest(), response)

    expect(response.cookie).toHaveBeenCalledWith(
      GITHUB_OAUTH_STATE_COOKIE,
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
    await controller.beginGitHubLogin('/', loggedOutRequest(), beginResponse)
    const stateCookie = (beginResponse.cookie as jest.Mock).mock.calls[0]?.[1] as string
    const authorizeUrl = new URL((beginResponse.redirect as jest.Mock).mock.calls[0]?.[1] as string)
    const response = responseDouble()

    await controller.completeGitHubLogin(
      'one-time-code',
      authorizeUrl.searchParams.get('state') ?? undefined,
      undefined,
      { cookies: { [GITHUB_OAUTH_STATE_COOKIE]: stateCookie } } as unknown as Request,
      response,
    )

    expect(response.clearCookie).toHaveBeenCalledWith(
      GITHUB_OAUTH_STATE_COOKIE,
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

  it('starts and completes Google OAuth with provider-bound state', async () => {
    const { authenticateGoogle, controller, create } = setup()
    const beginResponse = responseDouble()

    await controller.beginGoogleLogin('/plugin', loggedOutRequest(), beginResponse)

    expect(beginResponse.cookie).toHaveBeenCalledWith(
      GOOGLE_OAUTH_STATE_COOKIE,
      expect.any(String),
      expect.objectContaining({
        path: '/api/v1/auth/google/callback',
        httpOnly: true,
      }),
    )
    const authorizeUrl = new URL((beginResponse.redirect as jest.Mock).mock.calls[0]?.[1] as string)
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    )
    expect(authorizeUrl.searchParams.get('scope')).toBe('openid profile email')
    expect(authorizeUrl.searchParams.get('prompt')).toBe('select_account')

    const stateCookie = (beginResponse.cookie as jest.Mock).mock.calls[0]?.[1] as string
    const response = responseDouble()
    await controller.completeGoogleLogin(
      'google-code',
      authorizeUrl.searchParams.get('state') ?? undefined,
      undefined,
      { cookies: { [GOOGLE_OAUTH_STATE_COOKIE]: stateCookie } } as unknown as Request,
      response,
    )

    expect(authenticateGoogle).toHaveBeenCalledWith('google-code')
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ authProvider: 'GOOGLE', providerUserId: 'google-subject' }),
    )
    expect(response.redirect).toHaveBeenCalledWith(302, 'http://localhost:3000/plugin')
  })

  it('returns a normalized disabled-provider error', async () => {
    const { controller } = setup({ GOOGLE_OAUTH_ENABLED: false })

    await expect(
      controller.beginGoogleLogin('/', loggedOutRequest(), responseDouble()),
    ).rejects.toEqual(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'AUTH_PROVIDER_DISABLED',
          retryable: false,
        }),
      }),
    )
  })

  it('reads and revokes only the current cookie session', async () => {
    const { controller, read, revoke } = setup()
    const request = { cookies: { [USER_SESSION_COOKIE]: 'current-token' } } as unknown as Request
    const response = responseDouble()

    await expect(controller.readSession(request)).resolves.toMatchObject({
      user: { userName: 'octocat' },
    })
    await expect(controller.logout(request, response)).resolves.toEqual({ success: true })
    expect(read).toHaveBeenCalledWith('current-token')
    expect(revoke).toHaveBeenCalledWith('current-token')
    expect(response.clearCookie).toHaveBeenCalledWith(
      USER_SESSION_COOKIE,
      expect.not.objectContaining({ maxAge: expect.anything() }),
    )
  })

  it('requires logout before starting or replacing a login', async () => {
    const { controller, create, hasActiveSession } = setup()
    hasActiveSession.mockResolvedValue(true)
    const request = {
      cookies: { [USER_SESSION_COOKIE]: 'active-session-token' },
    } as unknown as Request

    await expect(controller.beginGitHubLogin('/', request, responseDouble())).rejects.toMatchObject(
      {
        status: 409,
      },
    )
    await expect(controller.beginGoogleLogin('/', request, responseDouble())).rejects.toMatchObject(
      {
        status: 409,
      },
    )
    expect(create).not.toHaveBeenCalled()
  })
})
