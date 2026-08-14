import { Buffer } from 'node:buffer';

import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../redis/redis.service';

const CHAT_WINDOW_SECONDS = 60;
const IMAGE_WINDOW_SECONDS = 60;
const IMAGE_LIMIT_PER_MINUTE = 5;
const ADMIN_LOGIN_WINDOW_SECONDS = 60;

export class RateLimitExceededException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        message: '请求过于频繁，请稍后重试',
        details: { retryAfterSeconds },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly chatLimit: number;
  private readonly imageLimit: number;
  private readonly adminLoginLimit: number;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.chatLimit = config.getOrThrow<number>('CHAT_RATE_LIMIT_PER_MINUTE');
    this.imageLimit = IMAGE_LIMIT_PER_MINUTE;
    this.adminLoginLimit = config.get<number>('ADMIN_LOGIN_RATE_LIMIT_PER_MINUTE', 5);
  }

  async consumeChat(clientIp: string | undefined): Promise<void> {
    const normalizedIp = normalizeClientIp(clientIp);
    const encodedIp = Buffer.from(normalizedIp).toString('base64url');

    try {
      const counter = await this.redis.incrementFixedWindow(
        `rate:chat:${encodedIp}`,
        CHAT_WINDOW_SECONDS,
      );
      if (counter.count > this.chatLimit) {
        throw new RateLimitExceededException(counter.retryAfterSeconds);
      }
    } catch (error) {
      if (error instanceof RateLimitExceededException) throw error;
      this.logger.error({ error, clientIp: normalizedIp }, 'Redis Chat rate limit failed closed');
      throw new HttpException('限流服务暂时不可用', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async consumeImage(clientIp: string | undefined): Promise<void> {
    await this.consume('image', clientIp, this.imageLimit, IMAGE_WINDOW_SECONDS);
  }

  async consumeAdminLogin(clientIp: string | undefined): Promise<void> {
    await this.consume('admin-login', clientIp, this.adminLoginLimit, ADMIN_LOGIN_WINDOW_SECONDS);
  }

  private async consume(
    capability: 'image' | 'admin-login',
    clientIp: string | undefined,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const normalizedIp = normalizeClientIp(clientIp);
    const encodedIp = Buffer.from(normalizedIp).toString('base64url');

    try {
      const counter = await this.redis.incrementFixedWindow(
        `rate:${capability}:${encodedIp}`,
        windowSeconds,
      );
      if (counter.count > limit) throw new RateLimitExceededException(counter.retryAfterSeconds);
    } catch (error) {
      if (error instanceof RateLimitExceededException) throw error;
      this.logger.error(
        { error, clientIp: normalizedIp, capability },
        'Redis rate limit failed closed',
      );
      throw new HttpException('限流服务暂时不可用', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}

export function normalizeClientIp(clientIp: string | undefined): string {
  const normalized = clientIp?.trim().replace(/^::ffff:/, '');
  return normalized || 'unknown';
}
