import { createHmac, timingSafeEqual } from 'node:crypto'

import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

const PREVIEW_TOKEN_TTL_SECONDS = 15 * 60

export interface AgentPreviewTokenClaims {
  runId: string
  userId: string
  port: number
  expiresAt: number
}

@Injectable()
export class AgentPreviewTokenService {
  private readonly secret: string

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.secret = config.getOrThrow<string>('USER_SESSION_SECRET')
  }

  issue(input: Omit<AgentPreviewTokenClaims, 'expiresAt'>): string {
    const claims: AgentPreviewTokenClaims = {
      ...input,
      expiresAt: Math.floor(Date.now() / 1_000) + PREVIEW_TOKEN_TTL_SECONDS,
    }
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `${payload}.${this.sign(payload)}`
  }

  verify(token: string): AgentPreviewTokenClaims {
    const [payload, signature, extra] = token.split('.')
    if (!payload || !signature || extra || !safeEqual(signature, this.sign(payload))) {
      throw new NotFoundException('网站预览不存在或已失效')
    }

    try {
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as Partial<AgentPreviewTokenClaims>
      if (
        typeof claims.runId !== 'string' ||
        typeof claims.userId !== 'string' ||
        !Number.isInteger(claims.port) ||
        (claims.port ?? 0) < 1 ||
        (claims.port ?? 0) > 65_535 ||
        typeof claims.expiresAt !== 'number' ||
        claims.expiresAt <= Math.floor(Date.now() / 1_000)
      ) {
        throw new Error('invalid claims')
      }
      return claims as AgentPreviewTokenClaims
    } catch {
      throw new NotFoundException('网站预览不存在或已失效')
    }
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url')
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
