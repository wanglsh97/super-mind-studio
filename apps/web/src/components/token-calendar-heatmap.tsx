'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { formatTokenValue } from '@/utils/usage/token-display'

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
  const [hoveredDay, setHoveredDay] = useState<{
    date: string
    totalTokens: number
    left: number
    top: number
  } | null>(null)

  return (
    <>
      <div className="overflow-x-auto pb-1" role="img" aria-label={ariaLabel}>
        <div className="mx-auto w-max">
          <div className="mb-2 ml-9 flex gap-1">
            {calendar.weeks.map((week, index) => (
              <div key={week.key} className="w-3 whitespace-nowrap text-[10px] text-slate-400">
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
                        onMouseEnter={({ currentTarget }) => {
                          const bounds = currentTarget.getBoundingClientRect()
                          setHoveredDay({
                            date: day.date,
                            totalTokens: day.totalTokens,
                            left: Math.max(
                              88,
                              Math.min(window.innerWidth - 88, bounds.left + bounds.width / 2),
                            ),
                            top: bounds.top - 8,
                          })
                        }}
                        onMouseLeave={() => setHoveredDay(null)}
                        className={`size-3 cursor-help rounded-[3px] transition-[box-shadow,transform] hover:scale-110 hover:ring-2 hover:ring-emerald-500/35 ${levelClass(tokenHeatLevel(day.totalTokens))}`}
                      />
                    ) : (
                      <span key={`empty-${index}`} className="size-3" />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] text-slate-400">
            {HEAT_LEGEND.map(({ level }) => (
              <span key={level} className="flex items-center gap-1 whitespace-nowrap">
                <span className={`size-3 rounded-[3px] ${levelClass(level)}`} />
              </span>
            ))}
          </div>
        </div>
      </div>
      {hoveredDay && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="tooltip"
              style={{ left: hoveredDay.left, top: hoveredDay.top }}
              className="pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-slate-950/95 px-3 py-2 text-white shadow-xl backdrop-blur"
            >
              <span className="block font-mono text-[10px] text-slate-400">{hoveredDay.date}</span>
              <strong className="mt-0.5 block whitespace-nowrap font-mono text-xs font-semibold">
                {formatTokenValue(hoveredDay.totalTokens)} Tokens
              </strong>
            </div>,
            document.body,
          )
        : null}
    </>
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
  }
}

export function tokenHeatLevel(value: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0
  if (value < 50_000_000) return 1
  if (value < 100_000_000) return 2
  if (value < 1_000_000_000) return 3
  return 4
}

const HEAT_LEGEND = [
  { level: 0, label: '0' },
  { level: 1, label: '< 5千万' },
  { level: 2, label: '< 1亿' },
  { level: 3, label: '< 10亿' },
  { level: 4, label: '≥ 10亿' },
] as const

function levelClass(level: 0 | 1 | 2 | 3 | 4): string {
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
