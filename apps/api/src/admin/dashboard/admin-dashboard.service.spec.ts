import type { ProviderHealthService } from '../../chat/provider-health.service'
import type { PrismaService } from '../../database/prisma.service'
import { RequestStatus } from '../../generated/prisma/client'
import { AdminDashboardService } from './admin-dashboard.service'
import type { TokenAnalyticsService } from '../../token-analytics/token-analytics.service'

function setup() {
  const findMany = jest.fn()
  const prisma = { requestLog: { findMany } } as unknown as PrismaService
  const getStatus = jest.fn().mockResolvedValue('healthy')
  const health = { getStatus } as unknown as ProviderHealthService
  const tokenAnalytics = { forAdmin: jest.fn() } as unknown as TokenAnalyticsService
  return {
    findMany,
    getStatus,
    service: new AdminDashboardService(prisma, health, tokenAnalytics),
  }
}

describe('AdminDashboardService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-17T10:30:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('returns today overview and health without selecting Prompt', async () => {
    const { findMany, getStatus, service } = setup()
    findMany.mockResolvedValue([
      { status: RequestStatus.SUCCEEDED, billing: { estimatedCostCny: '0.10000000' } },
      { status: RequestStatus.FAILED, billing: { estimatedCostCny: '0.02000000' } },
    ])

    await expect(service.overview()).resolves.toMatchObject({
      requestCount: 2,
      successRate: 0.5,
      estimatedCostCny: '0.12000000',
      health: expect.arrayContaining([{ model: 'qwen', status: 'healthy' }]),
    })
    expect(getStatus).toHaveBeenCalledTimes(4)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { status: true, billing: { select: { estimatedCostCny: true } } },
      }),
    )
    expect(JSON.stringify(findMany.mock.calls)).not.toContain('prompt')
  })

  it('builds 24-hour trend buckets from minimal fields', async () => {
    const { findMany, service } = setup()
    findMany.mockResolvedValue([
      { createdAt: new Date('2026-07-16T11:00:00.000Z'), status: RequestStatus.SUCCEEDED },
      { createdAt: new Date('2026-07-17T10:00:00.000Z'), status: RequestStatus.FAILED },
    ])

    const result = await service.trends()

    expect(result.buckets).toHaveLength(24)
    expect(result.buckets.reduce((sum, bucket) => sum + bucket.requests, 0)).toBe(2)
    expect(result.buckets.reduce((sum, bucket) => sum + bucket.failed, 0)).toBe(1)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: { createdAt: true, status: true } }),
    )
  })

  it('aggregates per-model duration and TTFB', async () => {
    const { findMany, service } = setup()
    findMany.mockResolvedValue([
      {
        modelAlias: 'qwen',
        durationMs: 200,
        startedAt: new Date('2026-07-17T10:00:00.000Z'),
        firstTokenAt: new Date('2026-07-17T10:00:00.050Z'),
      },
      {
        modelAlias: 'qwen',
        durationMs: 400,
        startedAt: new Date('2026-07-17T10:01:00.000Z'),
        firstTokenAt: new Date('2026-07-17T10:01:00.150Z'),
      },
    ])

    await expect(service.latencies()).resolves.toEqual([
      { model: 'qwen', count: 2, averageDurationMs: 300, averageTtfbMs: 100 },
    ])
  })

  it('returns recent normalized errors without Prompt or error details', async () => {
    const { findMany, service } = setup()
    findMany.mockResolvedValue([])

    await expect(service.errors()).resolves.toEqual([])
    expect(findMany).toHaveBeenCalledWith({
      where: { status: RequestStatus.FAILED },
      orderBy: { completedAt: 'desc' },
      take: 20,
      select: {
        requestId: true,
        capability: true,
        modelAlias: true,
        provider: true,
        errorCode: true,
        errorMessage: true,
        completedAt: true,
      },
    })
  })
})
