import {
  Inject,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { CookieOptions, Request, Response } from 'express'

import { createAnonymousIdentity } from './anonymous-identity'
import { GitHubOAuthClient } from './github-oauth.client'
import { GoogleOAuthClient } from './google-oauth.client'
import { type OAuthProvider, OAuthStateService, sanitizeReturnTo } from './oauth-state.service'
import {
  GITHUB_OAUTH_CLIENT,
  GITHUB_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_CLIENT,
  GOOGLE_OAUTH_STATE_COOKIE,
  USER_SESSION_COOKIE,
} from './user-auth.constants'
import { UserSessionService } from './user-session.service'

@ApiTags('User authentication')
@Controller('auth')
export class UserAuthController {
  private readonly githubEnabled: boolean
  private readonly googleEnabled: boolean
  private readonly production: boolean
  private readonly githubClientId: string | undefined
  private readonly githubCallbackUrl: string
  private readonly googleClientId: string | undefined
  private readonly googleCallbackUrl: string
  private readonly webOrigin: string
  private readonly sessionTtlSeconds: number

  constructor(
    @Inject(GITHUB_OAUTH_CLIENT) private readonly github: GitHubOAuthClient,
    @Inject(GOOGLE_OAUTH_CLIENT) private readonly google: GoogleOAuthClient,
    @Inject(OAuthStateService) private readonly oauthState: OAuthStateService,
    @Inject(UserSessionService) private readonly sessions: UserSessionService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.githubEnabled = config.get<boolean>('GITHUB_OAUTH_ENABLED', false)
    this.googleEnabled = config.get<boolean>('GOOGLE_OAUTH_ENABLED', false)
    this.production = config.get<string>('NODE_ENV') === 'production'
    this.githubClientId = config.get<string>('GITHUB_CLIENT_ID')
    this.githubCallbackUrl =
      config.get<string>('GITHUB_CALLBACK_URL') ??
      'http://localhost:3001/api/v1/auth/github/callback'
    this.googleClientId = config.get<string>('GOOGLE_CLIENT_ID')
    this.googleCallbackUrl =
      config.get<string>('GOOGLE_CALLBACK_URL') ??
      'http://localhost:3001/api/v1/auth/google/callback'
    this.webOrigin = config.getOrThrow<string>('WEB_ORIGIN')
    this.sessionTtlSeconds = config.getOrThrow<number>('USER_SESSION_TTL_SECONDS')
  }

  @Get('github')
  @ApiOperation({ summary: '发起 GitHub OAuth 登录' })
  @ApiQuery({
    name: 'returnTo',
    required: false,
    enum: ['/', '/chat/compare'],
  })
  @ApiFoundResponse({ description: '跳转到 GitHub authorize URL，并写入一次性 state Cookie' })
  @ApiServiceUnavailableResponse({ description: 'GitHub OAuth 尚未配置' })
  beginGitHubLogin(
    @Query('returnTo') returnTo: string | undefined,
    @Res() response: Response,
  ): void {
    this.assertProviderEnabled('GitHub', this.githubEnabled, this.githubClientId)
    const created = this.oauthState.create('GITHUB', returnTo)
    response.cookie(
      GITHUB_OAUTH_STATE_COOKIE,
      created.cookieValue,
      this.stateCookieOptions('GITHUB'),
    )

    const authorizeUrl = new URL('https://github.com/login/oauth/authorize')
    authorizeUrl.searchParams.set('client_id', this.githubClientId!)
    authorizeUrl.searchParams.set('redirect_uri', this.githubCallbackUrl)
    authorizeUrl.searchParams.set('scope', 'read:user user:email')
    authorizeUrl.searchParams.set('state', created.state)
    response.redirect(302, authorizeUrl.toString())
  }

  @Get('github/callback')
  @ApiOperation({ summary: '接收 GitHub OAuth callback' })
  @ApiFoundResponse({ description: '创建本地 Session 后跳回白名单页面，失败时跳回登录页' })
  async completeGitHubLogin(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const stateCookie = readCookie(request, GITHUB_OAUTH_STATE_COOKIE)
    response.clearCookie(GITHUB_OAUTH_STATE_COOKIE, this.stateCookieOptions('GITHUB', false))

    try {
      const returnTo = this.oauthState.verify('GITHUB', state, stateCookie)
      if (providerError || !code) {
        response.redirect(302, this.loginErrorUrl('authorization_rejected', returnTo))
        return
      }
      const identity = await this.github.authenticate(code)
      const session = await this.sessions.create(identity)
      response.cookie(USER_SESSION_COOKIE, session.token, this.sessionCookieOptions())
      response.redirect(302, new URL(returnTo, this.webOrigin).toString())
    } catch {
      response.redirect(302, this.loginErrorUrl('oauth_failed'))
    }
  }

  @Get('google')
  @ApiOperation({ summary: '发起 Google OAuth 登录' })
  @ApiQuery({
    name: 'returnTo',
    required: false,
    enum: ['/', '/chat/compare'],
  })
  @ApiFoundResponse({ description: '跳转到 Google authorize URL，并写入一次性 state Cookie' })
  @ApiServiceUnavailableResponse({ description: 'Google OAuth 尚未配置' })
  beginGoogleLogin(
    @Query('returnTo') returnTo: string | undefined,
    @Res() response: Response,
  ): void {
    this.assertProviderEnabled('Google', this.googleEnabled, this.googleClientId)
    const created = this.oauthState.create('GOOGLE', returnTo)
    response.cookie(
      GOOGLE_OAUTH_STATE_COOKIE,
      created.cookieValue,
      this.stateCookieOptions('GOOGLE'),
    )

    const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authorizeUrl.searchParams.set('client_id', this.googleClientId!)
    authorizeUrl.searchParams.set('redirect_uri', this.googleCallbackUrl)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('scope', 'openid profile email')
    authorizeUrl.searchParams.set('state', created.state)
    authorizeUrl.searchParams.set('prompt', 'select_account')
    response.redirect(302, authorizeUrl.toString())
  }

  @Get('google/callback')
  @ApiOperation({ summary: '接收 Google OAuth callback' })
  @ApiFoundResponse({ description: '创建本地 Session 后跳回白名单页面，失败时跳回登录页' })
  async completeGoogleLogin(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const stateCookie = readCookie(request, GOOGLE_OAUTH_STATE_COOKIE)
    response.clearCookie(GOOGLE_OAUTH_STATE_COOKIE, this.stateCookieOptions('GOOGLE', false))

    try {
      const returnTo = this.oauthState.verify('GOOGLE', state, stateCookie)
      if (providerError || !code) {
        response.redirect(302, this.loginErrorUrl('authorization_rejected', returnTo))
        return
      }
      const identity = await this.google.authenticate(code)
      const session = await this.sessions.create(identity)
      response.cookie(USER_SESSION_COOKIE, session.token, this.sessionCookieOptions())
      response.redirect(302, new URL(returnTo, this.webOrigin).toString())
    } catch {
      response.redirect(302, this.loginErrorUrl('oauth_failed'))
    }
  }

  @Post('anonymous')
  @ApiOperation({ summary: '创建一次性匿名用户 Session' })
  @ApiQuery({
    name: 'returnTo',
    required: false,
    enum: ['/', '/chat/compare'],
  })
  @ApiCreatedResponse({
    description: '创建本地 Session，并写入用户 Cookie',
    schema: {
      type: 'object',
      required: ['user', 'returnTo'],
      properties: {
        user: {
          type: 'object',
          required: ['id', 'authProvider', 'userName', 'avatarUrl'],
        },
        returnTo: { type: 'string' },
      },
    },
  })
  async anonymousLogin(
    @Query('returnTo') returnTo: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const identity = createAnonymousIdentity()
    const session = await this.sessions.create(identity)
    response.cookie(USER_SESSION_COOKIE, session.token, this.sessionCookieOptions())
    return { user: session.user, returnTo: sanitizeReturnTo(returnTo) }
  }

  @Get('session')
  @ApiOperation({ summary: '恢复当前用户 Session' })
  @ApiCookieAuth(USER_SESSION_COOKIE)
  @ApiOkResponse({
    description: '仅返回安全用户摘要，不返回邮箱、OAuth token 或 Session token',
    schema: {
      type: 'object',
      required: ['user'],
      properties: {
        user: {
          type: 'object',
          required: ['id', 'authProvider', 'userName', 'avatarUrl'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            authProvider: { type: 'string', enum: ['ANONYMOUS', 'GITHUB', 'GOOGLE'] },
            userName: { type: 'string' },
            avatarUrl: { type: 'string', format: 'uri', nullable: true },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: '用户 Session 缺失、失效或已过期' })
  async readSession(@Req() request: Request) {
    const user = await this.sessions.read(readCookie(request, USER_SESSION_COOKIE))
    return { user }
  }

  @Post('logout')
  @ApiOperation({ summary: '退出当前设备' })
  @ApiCookieAuth(USER_SESSION_COOKIE)
  @ApiCreatedResponse({ description: '仅撤销当前 UserSession' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.sessions.revoke(readCookie(request, USER_SESSION_COOKIE))
    response.clearCookie(USER_SESSION_COOKIE, this.sessionCookieOptions(false))
    return { success: true }
  }

  private stateCookieOptions(provider: OAuthProvider, includeMaxAge = true): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.production,
      path: `/api/v1/auth/${provider.toLowerCase()}/callback`,
      ...(includeMaxAge ? { maxAge: 10 * 60 * 1_000 } : {}),
    }
  }

  private sessionCookieOptions(includeMaxAge = true): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.production,
      path: '/api/v1',
      ...(includeMaxAge ? { maxAge: this.sessionTtlSeconds * 1_000 } : {}),
    }
  }

  private loginErrorUrl(error: string, returnTo = '/'): string {
    const url = new URL('/login', this.webOrigin)
    url.searchParams.set('error', error)
    url.searchParams.set('returnTo', returnTo)
    return url.toString()
  }

  private assertProviderEnabled(
    name: 'GitHub' | 'Google',
    enabled: boolean,
    clientId: string | undefined,
  ): asserts clientId is string {
    if (enabled && clientId) return
    throw new ServiceUnavailableException({
      code: 'AUTH_PROVIDER_DISABLED',
      message: `${name} 登录尚未配置`,
      retryable: false,
    })
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const cookies: unknown = request.cookies
  if (typeof cookies !== 'object' || cookies === null) return undefined
  const value = (cookies as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : undefined
}
