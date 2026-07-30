import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { modelTokenPieOption } from './token-model-chart'

describe('modelTokenPieOption', () => {
  it('renders resolved model totals as pie slices', () => {
    const option = modelTokenPieOption([
      { model: 'qwen3.7-plus', totalTokens: 12_000 },
      { model: 'deepseek-v3', totalTokens: 8_000 },
    ])

    const series = Array.isArray(option.series) ? option.series[0] : option.series
    assert.deepEqual(series, {
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
      data: [
        { name: 'qwen3.7-plus', value: 12_000 },
        { name: 'deepseek-v3', value: 8_000 },
      ],
    })
  })
})
