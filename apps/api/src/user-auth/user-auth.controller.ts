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

import { GitHubOAuthClient } from './github-oauth.client'
import { OAuthStateService } from './oauth-state.service'
import { GITHUB_OAUTH_CLIENT, OAUTH_STATE_COOKIE, USER_SESSION_COOKIE } from './user-auth.constants'
import { UserSessionService } from './user-session.service'

@ApiTags('User authentication')
@Controller('auth')
export class UserAuthController {
  private readonly enabled: boolean
  private readonly production: boolean
  private readonly clientId: string | undefined
  private readonly callbackUrl: string
  private readonly webOrigin: string
  private readonly sessionTtlSeconds: number

  constructor(
    @Inject(GITHUB_OAUTH_CLIENT) private readonly github: GitHubOAuthClient,
    @Inject(OAuthStateService) private readonly oauthState: OAuthStateService,
    @Inject(UserSessionService) private readonly sessions: UserSessionService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('GITHUB_OAUTH_ENABLED', false)
    this.production = config.get<string>('NODE_ENV') === 'production'
    this.clientId = config.get<string>('GITHUB_CLIENT_ID')
    this.callbackUrl = config.getOrThrow<string>('GITHUB_CALLBACK_URL')
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
    if (!this.enabled || !this.clientId) {
      throw new ServiceUnavailableException('GitHub 登录尚未配置')
    }
    const created = this.oauthState.create(returnTo)
    response.cookie(OAUTH_STATE_COOKIE, created.cookieValue, this.stateCookieOptions())

    const authorizeUrl = new URL('https://github.com/login/oauth/authorize')
    authorizeUrl.searchParams.set('client_id', this.clientId)
    authorizeUrl.searchParams.set('redirect_uri', this.callbackUrl)
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
    const stateCookie = readCookie(request, OAUTH_STATE_COOKIE)
    response.clearCookie(OAUTH_STATE_COOKIE, this.stateCookieOptions(false))

    try {
      const returnTo = this.oauthState.verify(state, stateCookie)
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
          required: ['id', 'githubId', 'githubUsername', 'displayName', 'avatarUrl'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            githubId: { type: 'string' },
            githubUsername: { type: 'string' },
            displayName: { type: 'string', nullable: true },
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

  private stateCookieOptions(includeMaxAge = true): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.production,
      path: '/api/v1/auth/github/callback',
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
}

function readCookie(request: Request, name: string): string | undefined {
  const cookies: unknown = request.cookies
  if (typeof cookies !== 'object' || cookies === null) return undefined
  const value = (cookies as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : undefined
}
