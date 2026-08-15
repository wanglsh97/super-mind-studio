import { Inject, Injectable } from '@nestjs/common';

import { TEXT_MODEL_ALIASES } from '../../chat/chat.constants';
import { ProviderHealthService } from '../../chat/provider-health.service';
import { PrismaService } from '../../database/prisma.service';
import { RequestStatus } from '../../generated/prisma/client';
import { TokenAnalyticsService } from '../../token-analytics/token-analytics.service';

const DAY_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class AdminDashboardService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProviderHealthService) private readonly health: ProviderHealthService,
    @Inject(TokenAnalyticsService) private readonly tokenAnalyticsService: TokenAnalyticsService,
  ) {}

  async overview() {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const requests = await this.prisma.requestLog.findMany({
      where: { createdAt: { gte: today } },
      select: { status: true, billing: { select: { estimatedCostCny: true } } },
    });
    const succeeded = requests.filter(({ status }) => status === RequestStatus.SUCCEEDED).length;
    const estimatedCostCny = requests
      .reduce((sum, { billing }) => sum + Number(billing?.estimatedCostCny ?? 0), 0)
      .toFixed(8);
    const health = await Promise.all(
      TEXT_MODEL_ALIASES.map(async (model) => ({
        model,
        status: await this.health.getStatus(model),
      })),
    );
    return {
      requestCount: requests.length,
      successRate: requests.length === 0 ? null : succeeded / requests.length,
      estimatedCostCny,
      health,
      generatedAt: now.toISOString(),
    };
  }

  async trends() {
    const now = new Date();
    const since = new Date(now.getTime() - DAY_MS);
    const requests = await this.prisma.requestLog.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, status: true },
    });
    const buckets = Array.from({ length: 24 }, (_, index) => {
      const start = new Date(since.getTime() + index * 60 * 60 * 1_000);
      return { start: start.toISOString(), requests: 0, succeeded: 0, failed: 0 };
    });
    for (const request of requests) {
      const index = Math.min(
        23,
        Math.max(0, Math.floor((request.createdAt.getTime() - since.getTime()) / 3_600_000)),
      );
      const bucket = buckets[index]!;
      bucket.requests += 1;
      if (request.status === RequestStatus.SUCCEEDED) bucket.succeeded += 1;
      if (request.status === RequestStatus.FAILED) bucket.failed += 1;
    }
    return { since: since.toISOString(), buckets };
  }

  async latencies() {
    const since = new Date(Date.now() - DAY_MS);
    const requests = await this.prisma.requestLog.findMany({
      where: {
        createdAt: { gte: since },
        status: RequestStatus.SUCCEEDED,
        durationMs: { not: null },
      },
      select: { modelAlias: true, durationMs: true, firstTokenAt: true, startedAt: true },
    });
    const grouped = new Map<
      string,
      { count: number; duration: number; ttfb: number; ttfbCount: number }
    >();
    for (const request of requests) {
      const group = grouped.get(request.modelAlias) ?? {
        count: 0,
        duration: 0,
        ttfb: 0,
        ttfbCount: 0,
      };
      group.count += 1;
      group.duration += request.durationMs ?? 0;
      if (request.firstTokenAt) {
        group.ttfb += Math.max(0, request.firstTokenAt.getTime() - request.startedAt.getTime());
        group.ttfbCount += 1;
      }
      grouped.set(request.modelAlias, group);
    }
    return [...grouped.entries()].map(([model, group]) => ({
      model,
      count: group.count,
      averageDurationMs: Math.round(group.duration / group.count),
      averageTtfbMs: group.ttfbCount === 0 ? null : Math.round(group.ttfb / group.ttfbCount),
    }));
  }

  async errors() {
    return this.prisma.requestLog.findMany({
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
    });
  }

  tokenAnalytics() {
    return this.tokenAnalyticsService.forAdmin();
  }
}
