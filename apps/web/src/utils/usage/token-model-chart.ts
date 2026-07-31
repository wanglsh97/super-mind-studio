import type { EChartsOption } from 'echarts'

import { formatTokenChartValue } from './token-display'

export function modelTokenPieOption(
  models: readonly { model: string; totalTokens: number }[],
): EChartsOption {
  return {
    color: ['#059669', '#34d399', '#60a5fa', '#818cf8', '#a78bfa', '#f59e0b', '#f472b6'],
    tooltip: {
      trigger: 'item',
      valueFormatter: formatTokenChartValue,
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 8,
      top: 'middle',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 14,
      textStyle: { fontSize: 12 },
    },
    series: [
      {
        name: 'Token 总量',
        type: 'pie',
        center: ['38%', '50%'],
        radius: ['42%', '72%'],
        minAngle: 2,
        padAngle: 2,
        itemStyle: {
          borderRadius: 5,
        },
        label: {
          formatter: '{b}\n{d}%',
          lineHeight: 18,
        },
        labelLine: {
          length: 12,
          length2: 8,
        },
        data: models.map(({ model, totalTokens }) => ({
          name: model,
          value: totalTokens,
        })),
      },
    ],
  }
}
