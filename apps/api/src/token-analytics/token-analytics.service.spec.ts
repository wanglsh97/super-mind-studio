import type { PrismaService } from '../database/prisma.service'
import { TokenAnalyticsService } from './token-analytics.service'

describe('TokenAnalyticsService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T12:00:00.000Z'))
  })

  afterEach(() => jest.useRealTimers())

  it('scopes user analytics and treats unavailable cache/reasoning as displayed zero', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        completedAt: new Date('2026-07-29T10:00:00.000Z'),
        resolvedModel: 'qwen3.7-plus',
        provider: 'qwen',
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
        cachedInputTokens: null,
        reasoningTokens: null,
        cacheUsageAvailable: false,
      },
    ])
    const service = new TokenAnalyticsService({
      agentModelInvocation: { findMany },
    } as unknown as PrismaService)

    const result = await service.forUser('user-1', 0)

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }),
    )
    expect(result.daily.find(({ date }) => date === '2026-07-29')).toEqual(
      expect.objectContaining({
        totalTokens: 140,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      }),
    )
    expect(result.models[0]).toMatchObject({ model: 'qwen3.7-plus', totalTokens: 140 })
  })

  it('uses weighted attributions without duplicating one invocation across names', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        completedAt: new Date('2026-07-29T10:00:00.000Z'),
        resolvedModel: 'glm-5',
        provider: 'glm',
        inputTokens: 80,
        outputTokens: 20,
        totalTokens: 100,
        cachedInputTokens: 40,
        reasoningTokens: 10,
        cacheUsageAvailable: true,
        attributions: [
          { kind: 'TOOL', name: 'web_search', weight: '0.5' },
          { kind: 'TOOL', name: 'web_fetch', weight: '0.5' },
        ],
      },
    ])
    const service = new TokenAnalyticsService({
      agentModelInvocation: { findMany },
    } as unknown as PrismaService)

    const result = await service.forAdmin()

    expect(result.today.cacheRate).toBe(0.5)
    expect(result.tools).toHaveLength(2)
    expect(result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'web_fetch', totalTokens: 50, cacheRate: 0.5 }),
        expect.objectContaining({ name: 'web_search', totalTokens: 50, cacheRate: 0.5 }),
      ]),
    )
  })
})
