import type { ChatAdapterId } from './chat.constants'
import type { ModelSummary } from '@supermind/sdk'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { RedisService } from '../redis/redis.service'

export type ProviderHealthStatus = ModelSummary['health']

export interface ProviderHealthSnapshot {
  status: ProviderHealthStatus
  consecutiveFailures: number
  averageLatencyMs: number | null
  lastSuccessAt?: string
  lastFailureAt?: string
  lastErrorCode?: string
  updatedAt: string
}

export interface ProviderFailure {
  code: string
  affectsHealth: boolean
}

@Injectable()
export class ProviderHealthService {
  private readonly logger = new Logger(ProviderHealthService.name)
  private readonly ttlSeconds: number
  private readonly failureThreshold: number

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.ttlSeconds = config.get<number>('PROVIDER_HEALTH_TTL_SECONDS', 300)
    this.failureThreshold = config.get<number>('PROVIDER_HEALTH_FAILURE_THRESHOLD', 3)
  }

  async getStatus(provider: ChatAdapterId): Promise<ProviderHealthStatus> {
    if (provider === 'mock') return 'unknown'

    try {
      return (await this.read(provider))?.status ?? 'unknown'
    } catch (error) {
      this.logger.warn({ error, provider }, 'Unable to read provider health projection')
      return 'unknown'
    }
  }

  async recordSuccess(provider: ChatAdapterId, latencyMs: number): Promise<void> {
    if (provider === 'mock') return

    await this.update(provider, (previous, now) => ({
      status: 'healthy',
      consecutiveFailures: 0,
      averageLatencyMs: rollingAverage(previous?.averageLatencyMs, latencyMs),
      lastSuccessAt: now,
      ...(previous?.lastFailureAt === undefined ? {} : { lastFailureAt: previous.lastFailureAt }),
      updatedAt: now,
    }))
    this.logger.log(
      {
        event: 'provider.request.completed',
        provider,
        outcome: 'success',
        providerLatencyMs: latencyMs,
        success: 1,
        error: 0,
      },
      'Provider request completed',
    )
  }

  async recordFailure(
    provider: ChatAdapterId,
    latencyMs: number,
    failure: ProviderFailure,
  ): Promise<void> {
    if (provider === 'mock') return

    await this.update(provider, (previous, now) => {
      const consecutiveFailures = failure.affectsHealth
        ? (previous?.consecutiveFailures ?? 0) + 1
        : (previous?.consecutiveFailures ?? 0)

      return {
        status: failure.affectsHealth
          ? consecutiveFailures >= this.failureThreshold
            ? 'unhealthy'
            : (previous?.status ?? 'unknown')
          : (previous?.status ?? 'unknown'),
        consecutiveFailures,
        averageLatencyMs: rollingAverage(previous?.averageLatencyMs, latencyMs),
        ...(previous?.lastSuccessAt === undefined ? {} : { lastSuccessAt: previous.lastSuccessAt }),
        lastFailureAt: now,
        lastErrorCode: failure.code,
        updatedAt: now,
      }
    })
    this.logger.log(
      {
        event: 'provider.request.completed',
        provider,
        outcome: 'error',
        providerLatencyMs: latencyMs,
        success: 0,
        error: 1,
        errorCode: failure.code,
        affectsHealth: failure.affectsHealth,
      },
      'Provider request completed',
    )
  }

  private async update(
    provider: ChatAdapterId,
    create: (previous: ProviderHealthSnapshot | undefined, now: string) => ProviderHealthSnapshot,
  ): Promise<void> {
    try {
      const previous = await this.read(provider)
      const next = create(previous, new Date().toISOString())
      await this.redis.setWithTtl(this.key(provider), JSON.stringify(next), this.ttlSeconds)
    } catch (error) {
      this.logger.warn({ error, provider }, 'Unable to update provider health projection')
    }
  }

  private async read(provider: ChatAdapterId): Promise<ProviderHealthSnapshot | undefined> {
    const value = await this.redis.get(this.key(provider))
    if (value === null) return undefined

    try {
      return JSON.parse(value) as ProviderHealthSnapshot
    } catch {
      return undefined
    }
  }

  private key(provider: ChatAdapterId): string {
    return `provider:health:${provider}`
  }
}

function rollingAverage(previous: number | null | undefined, current: number): number {
  if (previous === null || previous === undefined) return Math.max(0, Math.round(current))
  return Math.max(0, Math.round(previous * 0.75 + current * 0.25))
}
