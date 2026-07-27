import type { HealthIndicatorService } from '@nestjs/terminus'

import type { SandboxRuntimePort } from '../agent/sandbox/sandbox-runtime.port'
import type { PrismaService } from '../database/prisma.service'
import type { RedisService } from '../redis/redis.service'
import { ServiceHealthIndicator } from './service-health.indicator'

function createIndicator(sandbox: Pick<SandboxRuntimePort, 'healthCheck'>) {
  const status = {
    up: jest.fn(() => ({ opensandbox: { status: 'up' } })),
    down: jest.fn((details) => ({ opensandbox: { status: 'down', ...details } })),
  }
  const indicators = {
    check: jest.fn(() => status),
  } as unknown as HealthIndicatorService
  const service = new ServiceHealthIndicator(
    indicators,
    {} as PrismaService,
    {} as RedisService,
    sandbox as SandboxRuntimePort,
  )
  return { service, status }
}

describe('ServiceHealthIndicator OpenSandbox readiness', () => {
  it('reports the selected runtime as ready', async () => {
    const { service, status } = createIndicator({
      healthCheck: jest.fn().mockResolvedValue(undefined),
    })

    await expect(service.opensandbox()).resolves.toEqual({
      opensandbox: { status: 'up' },
    })
    expect(status.up).toHaveBeenCalled()
  })

  it('degrades readiness without exposing secret configuration', async () => {
    const { service, status } = createIndicator({
      healthCheck: jest.fn().mockRejectedValue(new Error('connection timed out')),
    })

    await expect(service.opensandbox()).resolves.toEqual({
      opensandbox: { status: 'down', message: 'connection timed out' },
    })
    expect(status.down).toHaveBeenCalled()
  })
})
