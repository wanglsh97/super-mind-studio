'use client'

import { createAIGatewayClient } from '@supermind/sdk'
import type { AgentTokenAnalytics, AgentTokenDailyUsage } from '@supermind/sdk'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { AnalyticsChart } from '../../components/analytics-chart'
import { ProtectedUserPage } from '../../components/protected-user-page'
import { TokenCalendarHeatmap } from '../../components/token-calendar-heatmap'
import { useAuthenticationFailure } from '../../components/use-authentication-failure'
import { paginateTokenDailyUsage } from '../../lib/token-daily-table'
import { formatTokenValue } from '../../lib/token-display'
import { modelTokenPieOption } from '../../lib/token-model-chart'

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
    <main className="min-h-screen px-4 py-8 sm:px-8 lg:px-12 lg:py-12">
      <div className="mx-auto w-full max-w-[76rem]">
        <header className="overflow-hidden rounded-[2rem] border border-line/80 bg-surface-card/72 px-6 py-7 shadow-[0_30px_90px_rgb(45_60_105/0.1)] backdrop-blur-2xl sm:px-8 sm:py-8 dark:border-line-soft dark:bg-surface-card/50">
          <p className="font-mono text-[0.66rem] font-bold tracking-[0.2em] text-brand uppercase">
            Agent usage ledger
          </p>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
            <div>
              <h1 className="font-display text-3xl font-semibold tracking-[-0.04em]">Token 用量</h1>
              <p className="mt-3 text-sm leading-6 text-ink-secondary dark:text-ink-dark-muted">
                最近一年的 Agent 模型消耗。缓存属于输入，思考属于输出，不会重复计入总量。
              </p>
            </div>
            {data ? (
              <span className="font-mono text-xs text-ink-faint">
                {data.from} — {data.to}
              </span>
            ) : null}
          </div>
          {state === 'loading' ? <LoadingState /> : null}
          {totals ? (
            <section
              className="mt-7 grid grid-cols-2 gap-2 border-t border-line/70 pt-5 sm:grid-cols-3 xl:grid-cols-5 dark:border-line-soft"
              aria-label="Token 汇总"
            >
              <MetricCard label="总量" value={totals.totalTokens} accent />
              <MetricCard label="输入" value={totals.inputTokens} />
              <MetricCard label="输出" value={totals.outputTokens} />
              <MetricCard label="缓存" value={totals.cachedInputTokens} />
              <MetricCard label="思考" value={totals.reasoningTokens} />
            </section>
          ) : null}
        </header>

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
            <section className="mt-6 rounded-[1.6rem] border border-line bg-surface-card/72 p-6 dark:border-line-soft dark:bg-surface-card/50">
              <div className="mb-5">
                <h2 className="font-display text-lg font-semibold">每日总量</h2>
              </div>
              <TokenCalendarHeatmap
                from={data.from}
                to={data.to}
                days={data.daily}
                ariaLabel="最近一年每日 Token 使用热力图"
              />
            </section>

            <section className="mt-6 grid grid-cols-1 gap-6">
              <ChartCard title="每日明细" description="按日期倒序；缓存与思考分别属于输入与输出。">
                <DailyUsageTable rows={data.daily} />
              </ChartCard>
              <ChartCard title="模型总量" description="按每次实际调用的模型归因。">
                {data.models.length === 0 ? (
                  <div className="flex h-[310px] items-center justify-center text-sm text-ink-faint">
                    暂无模型 Token 数据
                  </div>
                ) : (
                  <AnalyticsChart
                    label="每个模型的 Token 总量"
                    option={modelTokenPieOption(data.models)}
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
      className={`rounded-xl px-4 py-3.5 ${
        accent
          ? 'bg-emerald-50/90 ring-1 ring-emerald-200/80 dark:bg-emerald-950/35 dark:ring-emerald-800/80'
          : 'bg-surface-inset/65 dark:bg-surface-inset/35'
      }`}
    >
      <p className="text-xs font-semibold text-ink-faint">{label}</p>
      <strong className="mt-2 block font-mono text-xl tracking-[-0.04em]">
        {formatTokenValue(value)}
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
    <div
      className="mt-7 grid animate-pulse grid-cols-2 gap-2 border-t border-line/70 pt-5 sm:grid-cols-3 xl:grid-cols-5 dark:border-line-soft"
      aria-label="正在加载 Token 用量"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="h-[4.75rem] rounded-xl bg-surface-inset" />
      ))}
    </div>
  )
}

function DailyUsageTable({ rows }: { rows: readonly AgentTokenDailyUsage[] }) {
  const [requestedPage, setRequestedPage] = useState(1)
  const page = useMemo(() => paginateTokenDailyUsage(rows, requestedPage), [requestedPage, rows])

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs font-semibold text-ink-faint dark:border-line-soft">
              <th className="px-3 py-3 font-semibold">日期 ▼</th>
              {['总计', '输入', '输出', '缓存', '思考'].map((label) => (
                <th key={label} className="px-3 py-3 text-right font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr
                key={row.date}
                className="border-b border-line/70 transition-colors last:border-b-0 hover:bg-surface-inset/65 dark:border-line-soft"
              >
                <td className="px-3 py-3.5 font-mono text-ink-secondary dark:text-ink-dark-muted">
                  {row.date}
                </td>
                <TokenCell value={row.totalTokens} strong />
                <TokenCell value={row.inputTokens} />
                <TokenCell value={row.outputTokens} />
                <TokenCell value={row.cachedInputTokens} />
                <TokenCell value={row.reasoningTokens} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-line/70 pt-4 text-xs text-ink-faint dark:border-line-soft">
        <span>
          第 {page.page} / {page.totalPages} 页
        </span>
        <div className="flex gap-2">
          <PaginationButton
            label="上一页"
            disabled={page.page === 1}
            onClick={() => setRequestedPage(page.page - 1)}
          />
          <PaginationButton
            label="下一页"
            disabled={page.page === page.totalPages}
            onClick={() => setRequestedPage(page.page + 1)}
          />
        </div>
      </div>
    </div>
  )
}

function TokenCell({ value, strong = false }: { value: number; strong?: boolean }) {
  return (
    <td
      className={`px-3 py-3.5 text-right font-mono tabular-nums ${
        strong ? 'font-semibold text-ink' : 'text-ink-secondary dark:text-ink-dark-muted'
      }`}
    >
      {formatTokenValue(value)}
    </td>
  )
}

function PaginationButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg border border-line px-3 py-1.5 font-semibold text-ink-secondary transition-colors hover:bg-surface-inset disabled:cursor-not-allowed disabled:opacity-35 dark:border-line-soft dark:text-ink-dark-muted"
    >
      {label}
    </button>
  )
}
