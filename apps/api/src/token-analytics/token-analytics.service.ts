import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '../database/prisma.service'

export interface TokenMetrics {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  reasoningTokens: number
}

interface InvocationRow {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cachedInputTokens: number | null
  reasoningTokens: number | null
  completedAt: Date
  resolvedModel: string | null
  provider: string | null
  cacheUsageAvailable: boolean
  attributions?: Array<{ kind: 'SKILL' | 'TOOL'; name: string; weight: unknown }>
}

@Injectable()
export class TokenAnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async forUser(userId: string, timezoneOffsetMinutes = 0) {
    const period = recentCalendarPeriod(new Date(), timezoneOffsetMinutes, 12)
    const rows = await this.prisma.agentModelInvocation.findMany({
      where: {
        userId,
        completedAt: { gte: period.from, lt: period.toExclusive },
        usageUnknown: false,
      },
      select: invocationSelect,
      orderBy: { completedAt: 'asc' },
    })
    return {
      from: dateKey(period.from, timezoneOffsetMinutes),
      to: dateKey(new Date(period.toExclusive.getTime() - 1), timezoneOffsetMinutes),
      timezoneOffsetMinutes,
      daily: fillDaily(
        groupDaily(rows, timezoneOffsetMinutes),
        dateKey(period.from, timezoneOffsetMinutes),
        dateKey(new Date(period.toExclusive.getTime() - 1), timezoneOffsetMinutes),
      ),
      models: groupByModel(rows),
    }
  }

  async forAdmin() {
    const now = new Date()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const period = recentCalendarPeriod(now, 0, 3)
    const rows = await this.prisma.agentModelInvocation.findMany({
      where: {
        completedAt: { gte: period.from, lt: period.toExclusive },
        usageUnknown: false,
      },
      select: {
        ...invocationSelect,
        attributions: { select: { kind: true, name: true, weight: true } },
      },
      orderBy: { completedAt: 'asc' },
    })
    const todayRows = rows.filter((row) => row.completedAt >= today)
    return {
      generatedAt: now.toISOString(),
      today: sum(todayRows),
      models: groupByModel(todayRows),
      heatmap: {
        from: dateKey(period.from, 0),
        to: dateKey(new Date(period.toExclusive.getTime() - 1), 0),
        daily: groupDaily(rows, 0).map(({ date, totalTokens }) => ({ date, totalTokens })),
      },
      skills: groupAttributions(todayRows, 'SKILL'),
      tools: groupAttributions(todayRows, 'TOOL'),
    }
  }
}

const invocationSelect = {
  completedAt: true,
  resolvedModel: true,
  provider: true,
  inputTokens: true,
  outputTokens: true,
  totalTokens: true,
  cachedInputTokens: true,
  reasoningTokens: true,
  cacheUsageAvailable: true,
} as const

function metrics(row: {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cachedInputTokens: number | null
  reasoningTokens: number | null
}): TokenMetrics {
  return {
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    totalTokens: row.totalTokens ?? (row.inputTokens ?? 0) + (row.outputTokens ?? 0),
    cachedInputTokens: row.cachedInputTokens ?? 0,
    reasoningTokens: row.reasoningTokens ?? 0,
  }
}

function emptyMetrics(): TokenMetrics {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  }
}

function add(target: TokenMetrics, value: TokenMetrics, weight = 1): void {
  target.inputTokens += value.inputTokens * weight
  target.outputTokens += value.outputTokens * weight
  target.totalTokens += value.totalTokens * weight
  target.cachedInputTokens += value.cachedInputTokens * weight
  target.reasoningTokens += value.reasoningTokens * weight
}

function rounded(value: TokenMetrics): TokenMetrics {
  return {
    inputTokens: Math.round(value.inputTokens),
    outputTokens: Math.round(value.outputTokens),
    totalTokens: Math.round(value.totalTokens),
    cachedInputTokens: Math.round(value.cachedInputTokens),
    reasoningTokens: Math.round(value.reasoningTokens),
  }
}

function sum(
  rows: readonly InvocationRow[],
): TokenMetrics & { modelCalls: number; cacheRate: number } {
  const total = emptyMetrics()
  let cacheInputTokens = 0
  for (const row of rows) {
    add(total, metrics(row))
    if (row.cacheUsageAvailable) cacheInputTokens += row.inputTokens ?? 0
  }
  return {
    ...rounded(total),
    modelCalls: rows.length,
    cacheRate: cacheInputTokens === 0 ? 0 : total.cachedInputTokens / cacheInputTokens,
  }
}

function groupDaily(rows: readonly InvocationRow[], offset: number) {
  const groups = new Map<string, InvocationRow[]>()
  for (const row of rows) {
    const key = dateKey(row.completedAt, offset)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  return [...groups.entries()].map(([date, group]) => ({ date, ...sum(group) }))
}

function fillDaily(
  rows: ReturnType<typeof groupDaily>,
  from: string,
  to: string,
): ReturnType<typeof groupDaily> {
  const byDate = new Map(rows.map((row) => [row.date, row]))
  const filled: ReturnType<typeof groupDaily> = []
  const cursor = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10)
    filled.push(
      byDate.get(date) ?? {
        date,
        ...emptyMetrics(),
        modelCalls: 0,
        cacheRate: 0,
      },
    )
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return filled
}

function groupByModel(rows: readonly InvocationRow[]) {
  const groups = new Map<string, InvocationRow[]>()
  for (const row of rows) {
    const model = row.resolvedModel ?? row.provider ?? 'unknown'
    const group = groups.get(model) ?? []
    group.push(row)
    groups.set(model, group)
  }
  return [...groups.entries()]
    .map(([model, group]) => ({ model, ...sum(group) }))
    .sort((left, right) => right.totalTokens - left.totalTokens)
}

function groupAttributions(rows: readonly InvocationRow[], kind: 'SKILL' | 'TOOL') {
  const groups = new Map<
    string,
    TokenMetrics & { modelCalls: number; cacheInputTokens: number }
  >()
  for (const row of rows) {
    for (const attribution of row.attributions ?? []) {
      if (attribution.kind !== kind) continue
      const group = groups.get(attribution.name) ?? {
        ...emptyMetrics(),
        modelCalls: 0,
        cacheInputTokens: 0,
      }
      const weight = Number(attribution.weight)
      add(group, metrics(row), Number.isFinite(weight) ? weight : 0)
      group.modelCalls += weight
      if (row.cacheUsageAvailable) group.cacheInputTokens += (row.inputTokens ?? 0) * weight
      groups.set(attribution.name, group)
    }
  }
  return [...groups.entries()]
    .map(([name, group]) => ({
      name,
      ...rounded(group),
      modelCalls: Math.round(group.modelCalls * 100) / 100,
      cacheRate:
        group.cacheInputTokens === 0 ? 0 : group.cachedInputTokens / group.cacheInputTokens,
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)
}

function recentCalendarPeriod(
  now: Date,
  timezoneOffsetMinutes: number,
  months: number,
) {
  const shifted = new Date(now.getTime() - timezoneOffsetMinutes * 60_000)
  const fromLocal = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - months, shifted.getUTCDate()),
  )
  const toLocal = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1),
  )
  return {
    from: new Date(fromLocal.getTime() + timezoneOffsetMinutes * 60_000),
    toExclusive: new Date(toLocal.getTime() + timezoneOffsetMinutes * 60_000),
  }
}

function dateKey(date: Date, timezoneOffsetMinutes: number): string {
  return new Date(date.getTime() - timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10)
}
