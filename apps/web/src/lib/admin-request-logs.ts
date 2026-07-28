import { AdminApiError } from './admin-auth-client'

export interface RequestLogFilters {
  page?: number
  pageSize?: number
  from?: string
  to?: string
  capability?: string
  model?: string
  status?: string
  requestId?: string
  authProvider?: string
  userName?: string
  providerUserId?: string
}

export interface RequestLogUserSummary {
  id: string
  authProvider: 'ANONYMOUS' | 'GITHUB' | 'GOOGLE'
  userName: string
  avatarUrl: string | null
}

export interface RequestLogListItem {
  requestId: string
  capability: string
  modelAlias: string
  provider: string | null
  status: string
  stream: boolean
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  errorCode: string | null
  createdAt: string
  user: RequestLogUserSummary
  billing: {
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
    usageUnknown: boolean
    estimatedCostCny: string | null
  } | null
}

export interface RequestLogPage {
  items: RequestLogListItem[]
  page: number
  pageSize: number
  total: number
  pageCount: number
}

export interface RequestLogDetail extends Omit<RequestLogListItem, 'billing'> {
  prompt: unknown
  resolvedModel: string | null
  providerRequestId: string | null
  clientIp: string | null
  firstTokenAt: string | null
  failoverFrom: string | null
  failoverTo: string | null
  failoverReason: string | null
  errorMessage: string | null
  errorDetails: unknown
  metadata: unknown
  updatedAt: string
  user: RequestLogUserSummary & {
    providerUserId: string
  }
  billing: Record<string, unknown> | null
  imageTask: Record<string, unknown> | null
}

export async function loadRequestLogs(
  filters: RequestLogFilters,
  fetchImplementation: typeof fetch = fetch,
): Promise<RequestLogPage> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const response = await fetchImplementation(`/api/v1/admin/logs?${search}`, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw await responseError(response, '请求日志加载失败')
  }
  return (await response.json()) as RequestLogPage
}

export async function loadRequestLogDetail(
  requestId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<RequestLogDetail> {
  const response = await fetchImplementation(
    `/api/v1/admin/logs/${encodeURIComponent(requestId)}`,
    {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    },
  )
  if (!response.ok) throw await responseError(response, '请求日志详情加载失败')
  return (await response.json()) as RequestLogDetail
}

async function responseError(response: Response, fallback: string): Promise<AdminApiError> {
  let message = fallback
  try {
    const body = (await response.json()) as { message?: unknown }
    if (typeof body.message === 'string') message = body.message
  } catch {
    // Keep a stable fallback for non-JSON failures.
  }
  return new AdminApiError(response.status, message)
}
