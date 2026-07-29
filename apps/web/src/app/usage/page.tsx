'use client'

import { createAIGatewayClient } from '@supermind/sdk'
import type { AgentTokenAnalytics, AgentTokenDailyUsage } from '@supermind/sdk'
import type { EChartsOption } from 'echarts'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { AnalyticsChart } from '../../components/analytics-chart'
import { ProtectedUserPage } from '../../components/protected-user-page'
import { TokenCalendarHeatmap } from '../../components/token-calendar-heatmap'
import { useAuthenticationFailure } from '../../components/use-authentication-failure'

const client = createAIGatewayClient()

export default function UsagePage() {
  return (
    <ProtectedUserPage>
      <UsageAnalytics />
    </ProtectedUserPage>
  )
}

function UsageAnalytics() {
  const handleAuthenticationFailure = useAuthenticationFailure()
  const [data, setData] = useState<AgentTokenAnalytics | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      setData(
        await client.agent.analytics.get({
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      )
      setState('ready')
    } catch (cause) {
      if (handleAuthenticationFailure(cause)) return
      setError(cause instanceof Error ? cause.message : 'Token 用量加载失败')
      setState('error')
    }
  }, [handleAuthenticationFailure])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(
    () =>
      data?.daily.reduce(
        (sum, day) => ({
          inputTokens: sum.inputTokens + day.inputTokens,
          outputTokens: sum.outputTokens + day.outputTokens,
          totalTokens: sum.totalTokens + day.totalTokens,
          cachedInputTokens: sum.cachedInputTokens + day.cachedInputTokens,
          reasoningTokens: sum.reasoningTokens + day.reasoningTokens,
        }),
        {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
      ) ?? null,
    [data],
  )

  return (
    <main className="min-h-screen px-8 py-10 lg:px-12 lg:py-12">
      <div className="mx-auto w-full max-w-[76rem]">
        <header className="overflow-hidden rounded-[2rem] border border-line/80 bg-surface-card/72 px-8 py-8 shadow-[0_30px_90px_rgb(45_60_105/0.1)] backdrop-blur-2xl dark:border-line-soft dark:bg-surface-card/50">
          <p className="font-mono text-[0.66rem] font-bold tracking-[0.2em] text-brand uppercase">
            Agent usage ledger
          </p>
          <div className="mt-3 flex items-end justify-between gap-8">
            <div>
              <h1 className="font-display text-3xl font-semibold tracking-[-0.04em]">Token 用量</h1>
              <p className="mt-3 text-sm leading-6 text-ink-secondary dark:text-ink-dark-muted">
                最近三个月的 Agent 模型消耗。缓存属于输入，思考属于输出，不会重复计入总量。
              </p>
            </div>
            {data ? (
              <span className="font-mono text-xs text-ink-faint">
                {data.from} — {data.to}
              </span>
            ) : null}
          </div>
        </header>

        {state === 'loading' ? <LoadingState /> : null}
        {state === 'error' ? (
          <div className="mt-6 rounded-2xl border border-danger/20 bg-danger/7 px-5 py-4 text-sm text-danger">
            {error}
            <button className="ml-4 font-bold underline" onClick={() => void load()}>
              重新加载
            </button>
          </div>
        ) : null}

        {data && totals ? (
          <>
            <section className="mt-6 grid grid-cols-5 gap-3" aria-label="Token 汇总">
              <MetricCard label="总量" value={totals.totalTokens} accent />
              <MetricCard label="输入" value={totals.inputTokens} />
              <MetricCard label="输出" value={totals.outputTokens} />
              <MetricCard label="缓存" value={totals.cachedInputTokens} />
              <MetricCard label="思考" value={totals.reasoningTokens} />
            </section>

            <section className="mt-6 rounded-[1.6rem] border border-line bg-surface-card/72 p-6 dark:border-line-soft dark:bg-surface-card/50">
              <div className="mb-5">
                <h2 className="font-display text-lg font-semibold">每日总量</h2>
                <p className="mt-1 text-xs text-ink-faint">颜色越深，当天使用的 Token 越多。</p>
              </div>
              <TokenCalendarHeatmap
                from={data.from}
                to={data.to}
                days={data.daily}
                ariaLabel="最近三个月每日 Token 使用热力图"
              />
            </section>

            <section className="mt-6 grid grid-cols-[minmax(0,1.55fr)_minmax(22rem,0.85fr)] gap-6">
              <ChartCard title="每日明细" description="输入与输出是总量组成；缓存与思考为细分。">
                <AnalyticsChart
                  label="每日输入输出缓存和思考 Token"
                  option={dailyOption(data.daily)}
                  height={310}
                />
              </ChartCard>
              <ChartCard title="模型总量" description="按每次实际调用的模型归因。">
                {data.models.length === 0 ? (
                  <div className="flex h-[310px] items-center justify-center text-sm text-ink-faint">
                    暂无模型 Token 数据
                  </div>
                ) : (
                  <AnalyticsChart
                    label="每个模型的 Token 总量"
                    option={modelOption(data)}
                    height={310}
                  />
                )}
              </ChartCard>
            </section>
          </>
        ) : null}
      </div>
    </main>
  )
}

function MetricCard({
  label,
  value,
  accent = false,
}: {
  label: string
  value: number
  accent?: boolean
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        accent
          ? 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/30'
          : 'border-line bg-surface-card/72 dark:border-line-soft dark:bg-surface-card/50'
      }`}
    >
      <p className="text-xs font-semibold text-ink-faint">{label}</p>
      <strong className="mt-2 block font-mono text-xl tracking-[-0.04em]">
        {value.toLocaleString('zh-CN')}
      </strong>
    </div>
  )
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-[1.6rem] border border-line bg-surface-card/72 p-6 dark:border-line-soft dark:bg-surface-card/50">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-ink-faint">{description}</p>
      <div className="mt-4">{children}</div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="mt-6 grid animate-pulse grid-cols-5 gap-3" aria-label="正在加载 Token 用量">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="h-24 rounded-2xl bg-surface-inset" />
      ))}
    </div>
  )
}

function dailyOption(rows: AgentTokenDailyUsage[]): EChartsOption {
  return {
    color: ['#4f46e5', '#8b5cf6', '#10b981', '#f59e0b'],
    tooltip: { trigger: 'axis' },
    legend: { data: ['输入', '输出', '缓存', '思考'], top: 0 },
    grid: { left: 58, right: 16, top: 42, bottom: 48 },
    xAxis: {
      type: 'category',
      data: rows.map(({ date }) => date.slice(5)),
      axisLabel: { rotate: 45, interval: Math.max(0, Math.floor(rows.length / 12)) },
    },
    yAxis: { type: 'value' },
    series: [
      { name: '输入', type: 'bar', stack: 'total', data: rows.map((row) => row.inputTokens) },
      { name: '输出', type: 'bar', stack: 'total', data: rows.map((row) => row.outputTokens) },
      {
        name: '缓存',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: rows.map((row) => row.cachedInputTokens),
      },
      {
        name: '思考',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: rows.map((row) => row.reasoningTokens),
      },
    ],
  }
}

function modelOption(data: AgentTokenAnalytics): EChartsOption {
  return {
    color: ['#10b981'],
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 112, right: 16, top: 8, bottom: 28 },
    xAxis: { type: 'value' },
    yAxis: {
      type: 'category',
      data: data.models.map(({ model }) => model),
      axisLabel: { width: 104, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        data: data.models.map(({ totalTokens }) => totalTokens),
        barMaxWidth: 18,
      },
    ],
  }
}
