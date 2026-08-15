import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { AdminPublic } from './admin-public.decorator';
import type { AdminRequest } from './admin.guard';
import { ADMIN_SESSION_COOKIE, AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';

@ApiTags('Admin')
@Controller('admin/auth')
export class AdminAuthController {
  private readonly production: boolean;

  constructor(
    @Inject(AdminAuthService) private readonly auth: AdminAuthService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.production = config.get<string>('NODE_ENV') === 'production';
  }

  @Post('login')
  @AdminPublic()
  async login(
    @Body() input: AdminLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.rateLimit.consumeAdminLogin(request.ip);
    this.auth.verifyCredentials(input.username, input.password);
    const { token, session } = await this.auth.createSession();
    response.cookie(ADMIN_SESSION_COOKIE, token, this.auth.cookieOptions(this.production));
    return session;
  }

  @Get('session')
  @ApiCookieAuth(ADMIN_SESSION_COOKIE)
  session(@Req() request: AdminRequest) {
    return request.adminSession;
  }

  @Post('logout')
  @ApiCookieAuth(ADMIN_SESSION_COOKIE)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(ADMIN_SESSION_COOKIE, this.auth.cookieOptions(this.production, false));
    return { success: true };
  }
}
