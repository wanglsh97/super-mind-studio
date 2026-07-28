import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import { UserModule } from '../user/user.module'
import { GitHubOAuthClient } from './github-oauth.client'
import { OAuthStateService } from './oauth-state.service'
import { GITHUB_OAUTH_CLIENT } from './user-auth.constants'
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
          callbackUrl: config.getOrThrow<string>('GITHUB_CALLBACK_URL'),
          timeoutMs: config.getOrThrow<number>('GITHUB_OAUTH_HTTP_TIMEOUT_MS'),
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
