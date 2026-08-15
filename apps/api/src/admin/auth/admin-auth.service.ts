import { timingSafeEqual } from 'node:crypto';

import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { CookieOptions } from 'express';

export const ADMIN_SESSION_COOKIE = 'aigateway_admin_session';

export interface AdminSession {
  username: 'root';
  expiresAt: string;
}

interface AdminSessionClaims {
  sub: 'root';
  type: 'admin_session';
  version: 1;
  exp: number;
}

@Injectable()
export class AdminAuthService {
  private readonly secret: string;
  private readonly ttlSeconds: number;
  private readonly fixedCredentialsEnabled: boolean;

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('ADMIN_SESSION_SECRET');
    this.ttlSeconds = config.get<number>('ADMIN_SESSION_TTL_SECONDS', 900);
    this.fixedCredentialsEnabled = config.get<boolean>('ADMIN_FIXED_CREDENTIALS_ENABLED', true);
  }

  verifyCredentials(username: string, password: string): void {
    if (!this.fixedCredentialsEnabled) {
      throw new ServiceUnavailableException('管理员登录未开放；正式开放前必须升级认证方案');
    }
    if (!safeEqual(username, 'root') || !safeEqual(password, '123456')) {
      throw new UnauthorizedException('用户名或密码错误');
    }
  }

  async createSession(): Promise<{ token: string; session: AdminSession }> {
    const expiresAtSeconds = Math.floor(Date.now() / 1_000) + this.ttlSeconds;
    const token = await this.jwt.signAsync(
      { sub: 'root', type: 'admin_session', version: 1, exp: expiresAtSeconds },
      { secret: this.secret },
    );
    return {
      token,
      session: {
        username: 'root',
        expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
      },
    };
  }

  async readSession(token: string | undefined): Promise<AdminSession> {
    if (!token) throw new UnauthorizedException('管理员会话无效或已过期');
    try {
      const claims = await this.jwt.verifyAsync<AdminSessionClaims>(token, { secret: this.secret });
      if (claims.sub !== 'root' || claims.type !== 'admin_session' || claims.version !== 1) {
        throw new Error('invalid admin session claims');
      }
      return { username: 'root', expiresAt: new Date(claims.exp * 1_000).toISOString() };
    } catch {
      throw new UnauthorizedException('管理员会话无效或已过期');
    }
  }

  cookieOptions(production: boolean, includeMaxAge = true): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: production,
      path: '/api/v1/admin',
      ...(includeMaxAge ? { maxAge: this.ttlSeconds * 1_000 } : {}),
    };
  }
}

function safeEqual(value: string, expected: string): boolean {
  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
