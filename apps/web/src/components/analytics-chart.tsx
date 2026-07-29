'use client'

import type { ECharts, EChartsOption } from 'echarts'
import { useEffect, useRef } from 'react'

export function AnalyticsChart({
  option,
  label,
  height = 280,
}: {
  option: EChartsOption
  label: string
  height?: number
}) {
  const container = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!container.current) return
    let chart: ECharts | undefined
    let disposed = false
    void import('echarts').then((echarts) => {
      if (disposed || !container.current) return
      chart = echarts.init(container.current)
      chart.setOption(option)
    })
    const resize = () => chart?.resize()
    window.addEventListener('resize', resize)
    return () => {
      disposed = true
      window.removeEventListener('resize', resize)
      chart?.dispose()
    }
  }, [option])
  return <div ref={container} role="img" aria-label={label} style={{ width: '100%', height }} />
}
