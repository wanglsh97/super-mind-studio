import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD, Reflector } from '@nestjs/core';

import { RateLimitModule } from '../../rate-limit/rate-limit.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [JwtModule.register({}), RateLimitModule],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    Reflector,
    {
      provide: APP_GUARD,
      useClass: AdminGuard,
    },
  ],
  exports: [AdminAuthService],
})
export class AdminAuthModule {}
