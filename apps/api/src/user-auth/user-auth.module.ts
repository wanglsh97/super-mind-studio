import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import { UserModule } from '../user/user.module'
import { GitHubOAuthClient } from './github-oauth.client'
import { GoogleOAuthClient } from './google-oauth.client'
import { OAuthStateService } from './oauth-state.service'
import { GITHUB_OAUTH_CLIENT, GOOGLE_OAUTH_CLIENT } from './user-auth.constants'
import { UserAuthController } from './user-auth.controller'
import { UserSessionService } from './user-session.service'
import { UserSessionGuard } from './user-session.guard'

@Module({
  imports: [ConfigModule, UserModule],
  controllers: [UserAuthController],
  providers: [
    UserSessionService,
    UserSessionGuard,
    {
      provide: GITHUB_OAUTH_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new GitHubOAuthClient({
          clientId: config.get<string>('GITHUB_CLIENT_ID') ?? 'disabled',
          clientSecret: config.get<string>('GITHUB_CLIENT_SECRET') ?? 'disabled',
          callbackUrl:
            config.get<string>('GITHUB_CALLBACK_URL') ??
            'http://localhost:3001/api/v1/auth/github/callback',
          timeoutMs: config.get<number>('GITHUB_OAUTH_HTTP_TIMEOUT_MS') ?? 10_000,
        }),
    },
    {
      provide: GOOGLE_OAUTH_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new GoogleOAuthClient({
          clientId: config.get<string>('GOOGLE_CLIENT_ID') ?? 'disabled',
          clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') ?? 'disabled',
          callbackUrl:
            config.get<string>('GOOGLE_CALLBACK_URL') ??
            'http://localhost:3001/api/v1/auth/google/callback',
          timeoutMs: config.get<number>('GOOGLE_OAUTH_HTTP_TIMEOUT_MS') ?? 10_000,
        }),
    },
    {
      provide: OAuthStateService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new OAuthStateService(config.getOrThrow<string>('USER_SESSION_SECRET')),
    },
  ],
  exports: [UserSessionService, UserSessionGuard],
})
export class UserAuthModule {}
