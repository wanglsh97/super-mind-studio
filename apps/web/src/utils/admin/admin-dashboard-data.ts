import { AdminApiError } from './admin-auth-client'

export interface DashboardOverview {
  requestCount: number
  successRate: number | null
  estimatedCostCny: string
  health: Array<{ model: string; status: 'unknown' | 'healthy' | 'unhealthy' }>
  generatedAt: string
}

export interface DashboardTrends {
  since: string
  buckets: Array<{ start: string; requests: number; succeeded: number; failed: number }>
}

export type DashboardLatencies = Array<{
  model: string
  count: number
  averageDurationMs: number
  averageTtfbMs: number | null
}>

export type DashboardErrors = Array<{
  requestId: string
  capability: string
  modelAlias: string
  provider: string | null
  errorCode: string | null
  errorMessage: string | null
  completedAt: string | null
}>

export interface DashboardTokenMetrics {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  reasoningTokens: number
}

export interface DashboardTokenAnalytics {
  generatedAt: string
  today: DashboardTokenMetrics & { modelCalls: number; cacheRate: number }
  models: Array<DashboardTokenMetrics & { model: string; modelCalls: number; cacheRate: number }>
  heatmap: {
    from: string
    to: string
    daily: Array<{ date: string; totalTokens: number }>
  }
  skills: Array<DashboardTokenMetrics & { name: string; modelCalls: number; cacheRate: number }>
  tools: Array<DashboardTokenMetrics & { name: string; modelCalls: number; cacheRate: number }>
}

export type DashboardSection<T> =
  { status: 'success'; data: T } | { status: 'error'; message: string; unauthorized: boolean }

export interface DashboardData {
  overview: DashboardSection<DashboardOverview>
  trends: DashboardSection<DashboardTrends>
  latencies: DashboardSection<DashboardLatencies>
  errors: DashboardSection<DashboardErrors>
  tokenAnalytics: DashboardSection<DashboardTokenAnalytics>
}

export async function loadDashboard(
  fetchImplementation: typeof fetch = fetch,
): Promise<DashboardData> {
  const [overview, trends, latencies, errors, tokenAnalytics] = await Promise.allSettled([
    request<DashboardOverview>('overview', fetchImplementation),
    request<DashboardTrends>('trends', fetchImplementation),
    request<DashboardLatencies>('latencies', fetchImplementation),
    request<DashboardErrors>('errors', fetchImplementation),
    request<DashboardTokenAnalytics>('token-analytics', fetchImplementation),
  ])
  return {
    overview: section(overview),
    trends: section(trends),
    latencies: section(latencies),
    errors: section(errors),
    tokenAnalytics: section(tokenAnalytics),
  }
}

function section<T>(result: PromiseSettledResult<T>): DashboardSection<T> {
  if (result.status === 'fulfilled') return { status: 'success', data: result.value }
  const error = result.reason
  return {
    status: 'error',
    message: error instanceof Error ? error.message : '数据加载失败',
    unauthorized: error instanceof AdminApiError && error.status === 401,
  }
}

async function request<T>(sectionName: string, fetchImplementation: typeof fetch): Promise<T> {
  const response = await fetchImplementation(`/api/v1/admin/dashboard/${sectionName}`, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!response.ok) {
    let message = `Dashboard ${sectionName} 加载失败`
    try {
      const body = (await response.json()) as { message?: unknown }
      if (typeof body.message === 'string') message = body.message
    } catch {
      // Preserve the section-specific fallback for non-JSON errors.
    }
    throw new AdminApiError(response.status, message)
  }
  return (await response.json()) as T
}
