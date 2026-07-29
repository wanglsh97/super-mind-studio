'use client'

import { useMemo } from 'react'

export interface TokenCalendarDay {
  date: string
  totalTokens: number
}

export function TokenCalendarHeatmap({
  from,
  to,
  days,
  ariaLabel,
}: {
  from: string
  to: string
  days: readonly TokenCalendarDay[]
  ariaLabel: string
}) {
  const calendar = useMemo(() => buildCalendar(from, to, days), [days, from, to])
  return (
    <div className="overflow-x-auto pb-1" role="img" aria-label={ariaLabel}>
      <div className="min-w-max">
        <div className="mb-2 ml-9 flex gap-1">
          {calendar.weeks.map((week, index) => (
            <div key={week.key} className="w-3 text-[10px] text-slate-400">
              {calendar.monthLabels.get(index) ?? ''}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="grid grid-rows-7 gap-1 pt-0 text-[10px] leading-3 text-slate-400">
            {['日', '', '二', '', '四', '', '六'].map((label, index) => (
              <span key={`${label}-${index}`} className="h-3">
                {label}
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            {calendar.weeks.map((week) => (
              <div key={week.key} className="grid grid-rows-7 gap-1">
                {week.days.map((day, index) =>
                  day ? (
                    <span
                      key={day.date}
                      title={`${day.date} · ${day.totalTokens.toLocaleString('zh-CN')} Tokens`}
                      className={`size-3 rounded-[3px] ${heatClass(day.totalTokens, calendar.max)}`}
                    />
                  ) : (
                    <span key={`empty-${index}`} className="size-3" />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-slate-400">
          <span className="mr-1">少</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className={`size-3 rounded-[3px] ${levelClass(level)}`} />
          ))}
          <span className="ml-1">多</span>
        </div>
      </div>
    </div>
  )
}

function buildCalendar(from: string, to: string, values: readonly TokenCalendarDay[]) {
  const totals = new Map(values.map((day) => [day.date, day.totalTokens]))
  const start = parseDate(from)
  const end = parseDate(to)
  start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()))
  const weeks: Array<{ key: string; days: Array<TokenCalendarDay | null> }> = []
  const monthLabels = new Map<number, string>()
  let previousMonth = -1
  for (let cursor = new Date(start), weekIndex = 0; cursor <= end; weekIndex += 1) {
    const week = { key: toDateKey(cursor), days: [] as Array<TokenCalendarDay | null> }
    for (let day = 0; day < 7; day += 1) {
      const key = toDateKey(cursor)
      const inRange = key >= from && key <= to
      week.days.push(inRange ? { date: key, totalTokens: totals.get(key) ?? 0 } : null)
      if (inRange && cursor.getUTCMonth() !== previousMonth) {
        monthLabels.set(weekIndex, `${cursor.getUTCMonth() + 1}月`)
        previousMonth = cursor.getUTCMonth()
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    weeks.push(week)
  }
  return {
    weeks,
    monthLabels,
    max: Math.max(0, ...values.map((day) => day.totalTokens)),
  }
}

function heatClass(value: number, max: number): string {
  if (value <= 0 || max <= 0) return levelClass(0)
  const ratio = value / max
  if (ratio <= 0.25) return levelClass(1)
  if (ratio <= 0.5) return levelClass(2)
  if (ratio <= 0.75) return levelClass(3)
  return levelClass(4)
}

function levelClass(level: number): string {
  return [
    'bg-slate-100 dark:bg-white/[0.06]',
    'bg-emerald-100 dark:bg-emerald-950',
    'bg-emerald-300 dark:bg-emerald-800',
    'bg-emerald-500 dark:bg-emerald-600',
    'bg-emerald-700 dark:bg-emerald-400',
  ][level]!
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}
