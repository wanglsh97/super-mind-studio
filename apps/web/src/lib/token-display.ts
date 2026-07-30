const WAN_TOKENS = 10_000
const YI_TOKENS = 100_000_000

export function formatTokenValue(value: number): string {
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0
  if (normalized < WAN_TOKENS) {
    return Math.round(normalized).toLocaleString('zh-CN')
  }
  if (normalized >= YI_TOKENS) {
    return `${(normalized / YI_TOKENS).toLocaleString('zh-CN', {
      maximumFractionDigits: 2,
    })}亿`
  }
  return `${(normalized / WAN_TOKENS).toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
  })}万`
}

export function formatTokenChartValue(value: unknown): string {
  return formatTokenValue(typeof value === 'number' ? value : Number(value))
}
