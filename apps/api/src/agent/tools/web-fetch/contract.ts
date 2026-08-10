import { AgentToolExecutionError, type AgentToolResult } from '../agent-tool'

/**
 * `web_fetch` 公共契约（JSON Schema、审计字段、错误码、结果形状）。
 *
 * 板块 3 后续实现（URL/DNS/SSRF、重定向、HTTP client、内容抽取）在保持本契约稳定的前提下替换执行体。
 */

export const WEB_FETCH_TOOL_NAME = 'web_fetch' as const

/** 模型可见的 JSON Schema 参数定义。 */
export const WEB_FETCH_TOOL_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: {
      type: 'string',
      minLength: 1,
      description: 'The public HTTP/HTTPS URL to fetch.',
    },
  },
}

/** 持久化/UI 审计投影。禁止包含 Cookie、Authorization 或敏感响应头。 */
export interface WebFetchAudit {
  requestedUrl?: string
  finalUrl?: string
  status?: number | null
  contentType?: string | null
  bytes?: number | null
  durationMs?: number | null
  truncated?: boolean
  title?: string | null
  contentHash?: string | null
  errorCode?: string | null
}

export type WebFetchErrorCode =
  | 'WEB_FETCH_INVALID_ARGS'
  | 'WEB_FETCH_INVALID_URL'
  | 'WEB_FETCH_UNSUPPORTED_PROTOCOL'
  | 'WEB_FETCH_BLOCKED_TARGET'
  | 'WEB_FETCH_REDIRECT_LIMIT'
  | 'WEB_FETCH_TIMEOUT'
  | 'WEB_FETCH_SIZE_LIMIT'
  | 'WEB_FETCH_UNSUPPORTED_CONTENT'
  | 'WEB_FETCH_ABORTED'
  | 'WEB_FETCH_FAILED'

export function createWebFetchSuccessResult(input: {
  content: string
  summary: string
  audit: WebFetchAudit
}): AgentToolResult {
  return {
    content: input.content,
    summary: input.summary,
    isError: false,
    audit: sanitizeWebFetchAudit(input.audit) as Record<string, unknown>,
  }
}

export function createWebFetchErrorResult(input: {
  code: WebFetchErrorCode
  message: string
  summary?: string
  audit?: WebFetchAudit
}): never {
  const summary = input.summary ?? input.message
  const audit = sanitizeWebFetchAudit({
    ...input.audit,
    errorCode: input.audit?.errorCode ?? input.code,
  }) as Record<string, unknown>
  throw new AgentToolExecutionError({
    code: input.code,
    message: `${input.message}。请检查 URL、网络状态或目标页面后再决定是否重试。`,
    summary,
    retryable: input.code !== 'WEB_FETCH_ABORTED' && input.code !== 'WEB_FETCH_BLOCKED_TARGET',
    audit,
  })
}

/** 去掉审计中的敏感键，防止误记 Cookie/Authorization 等。 */
export function sanitizeWebFetchAudit(audit: WebFetchAudit): WebFetchAudit {
  const blocked = new Set([
    'cookie',
    'set-cookie',
    'authorization',
    'proxy-authorization',
    'x-api-key',
    'api-key',
  ])
  const out: WebFetchAudit = {}
  for (const [key, value] of Object.entries(audit)) {
    if (blocked.has(key.toLowerCase())) continue
    ;(out as Record<string, unknown>)[key] = value
  }
  return out
}
