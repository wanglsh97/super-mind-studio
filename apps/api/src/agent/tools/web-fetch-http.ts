import { Client } from 'undici'

import { AgentToolExecutionError } from './agent-tool'
import { pickPinnedAddress, resolveAndValidateHost, type HostResolver } from './web-fetch-dns'
import { isAllowedContentType, isDeniedContentType } from './web-fetch-extract'
import { normalizeWebFetchUrl, type NormalizedWebFetchUrl } from './web-fetch-url'

export const WEB_FETCH_MAX_REDIRECTS = 5
export const WEB_FETCH_MAX_BYTES = 2 * 1024 * 1024
export const WEB_FETCH_CONNECT_TIMEOUT_MS = 5_000
export const WEB_FETCH_TOTAL_TIMEOUT_MS = 20_000

export interface WebFetchHttpResponse {
  finalUrl: string
  status: number
  contentType: string | null
  body: string
  bytes: number
  redirected: boolean
  hopCount: number
}

export interface WebFetchHttpDeps {
  resolveHost?: HostResolver
  request?: typeof performPinnedRequest
  now?: () => number
}

interface PinnedRequestInput {
  url: NormalizedWebFetchUrl
  pinnedIp: string
  signal: AbortSignal
  method?: 'GET' | 'HEAD'
}

interface PinnedRequestResult {
  status: number
  headers: Record<string, string>
  body: Buffer
  location: string | null
}

/**
 * 受限 HTTP(S) 抓取：无 Cookie/Authorization、手动重定向、逐跳 URL+DNS 校验、2MiB 上限。
 */
export async function fetchValidatedUrl(
  rawUrl: string,
  signal: AbortSignal,
  deps: WebFetchHttpDeps = {},
): Promise<WebFetchHttpResponse> {
  const resolveHost = deps.resolveHost
  const doRequest = deps.request ?? performPinnedRequest
  const startedAt = (deps.now ?? Date.now)()
  const deadline = startedAt + WEB_FETCH_TOTAL_TIMEOUT_MS

  let current = normalizeWebFetchUrl(rawUrl)
  let redirected = false
  const seen = new Set<string>([current.href])

  for (let hop = 0; hop <= WEB_FETCH_MAX_REDIRECTS; hop += 1) {
    throwIfAborted(signal)
    throwIfDeadline(deadline, deps.now ?? Date.now)

    const resolved = await resolveAndValidateHost(current.hostname, resolveHost)
    const pinnedIp = pickPinnedAddress(resolved)

    const remaining = Math.max(1, deadline - (deps.now ?? Date.now)())
    const hopTimeout = Math.min(WEB_FETCH_CONNECT_TIMEOUT_MS + remaining, remaining)
    const hopSignal = AbortSignal.any([signal, AbortSignal.timeout(hopTimeout)])

    const response = await doRequest({
      url: current,
      pinnedIp,
      signal: hopSignal,
    })

    if (isRedirectStatus(response.status)) {
      redirected = true
      if (hop >= WEB_FETCH_MAX_REDIRECTS) {
        throw new AgentToolExecutionError({
          code: 'WEB_FETCH_REDIRECT_LIMIT',
          message: `web_fetch 重定向超过 ${WEB_FETCH_MAX_REDIRECTS} 次`,
          summary: '重定向次数超限',
          audit: { finalUrl: current.href, status: response.status },
        })
      }
      if (!response.location) {
        throw new AgentToolExecutionError({
          code: 'WEB_FETCH_FAILED',
          message: 'web_fetch 收到重定向但缺少 Location',
          summary: '重定向无效',
          audit: { finalUrl: current.href, status: response.status },
        })
      }
      const nextRaw = new URL(response.location, current.href).toString()
      const next = normalizeWebFetchUrl(nextRaw)
      if (seen.has(next.href)) {
        throw new AgentToolExecutionError({
          code: 'WEB_FETCH_REDIRECT_LIMIT',
          message: 'web_fetch 检测到重定向循环',
          summary: '重定向循环',
          audit: { finalUrl: next.href, status: response.status },
        })
      }
      seen.add(next.href)
      current = next
      continue
    }

    const contentType = response.headers['content-type'] ?? null
    if (isDeniedContentType(contentType) || !isAllowedContentType(contentType)) {
      throw new AgentToolExecutionError({
        code: 'WEB_FETCH_UNSUPPORTED_CONTENT',
        message: `web_fetch 不支持的 Content-Type：${contentType ?? 'missing'}`,
        summary: '不支持的内容类型',
        audit: {
          finalUrl: current.href,
          status: response.status,
          contentType,
        },
      })
    }

    if (response.body.byteLength > WEB_FETCH_MAX_BYTES) {
      throw new AgentToolExecutionError({
        code: 'WEB_FETCH_SIZE_LIMIT',
        message: `web_fetch 响应超过 ${WEB_FETCH_MAX_BYTES} 字节`,
        summary: '响应过大',
        audit: {
          finalUrl: current.href,
          status: response.status,
          bytes: response.body.byteLength,
        },
      })
    }

    return {
      finalUrl: current.href,
      status: response.status,
      contentType,
      body: response.body.toString('utf8'),
      bytes: response.body.byteLength,
      redirected,
      hopCount: hop,
    }
  }

  throw new AgentToolExecutionError({
    code: 'WEB_FETCH_REDIRECT_LIMIT',
    message: `web_fetch 重定向超过 ${WEB_FETCH_MAX_REDIRECTS} 次`,
    summary: '重定向次数超限',
  })
}

export async function performPinnedRequest(
  input: PinnedRequestInput,
): Promise<PinnedRequestResult> {
  const { url, pinnedIp, signal } = input
  const parsed = new URL(url.href)
  const originPath = `${parsed.pathname}${parsed.search}` || '/'
  const authority = pinnedIp.includes(':') ? `[${pinnedIp}]` : pinnedIp
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  const origin = `${url.protocol}//${authority}:${port}`

  const client = new Client(origin, {
    connectTimeout: WEB_FETCH_CONNECT_TIMEOUT_MS,
    ...(url.protocol === 'https:'
      ? {
          connect: {
            servername: url.hostname,
          },
        }
      : {}),
  })

  try {
    const response = await client.request({
      path: originPath,
      method: input.method ?? 'GET',
      signal,
      headersTimeout: WEB_FETCH_CONNECT_TIMEOUT_MS,
      bodyTimeout: WEB_FETCH_TOTAL_TIMEOUT_MS,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.1',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'user-agent': 'SuperMindStudio-WebFetch/1.0',
        host: url.port ? `${url.hostname}:${url.port}` : url.hostname,
      },
    })

    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of response.body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buf.byteLength
      if (total > WEB_FETCH_MAX_BYTES + 1) {
        await response.body.dump().catch(() => undefined)
        throw new AgentToolExecutionError({
          code: 'WEB_FETCH_SIZE_LIMIT',
          message: `web_fetch 响应超过 ${WEB_FETCH_MAX_BYTES} 字节`,
          summary: '响应过大',
          audit: { finalUrl: url.href, bytes: total },
        })
      }
      chunks.push(buf)
    }

    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(response.headers)) {
      if (typeof value === 'string') headers[key.toLowerCase()] = value
      else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(', ')
    }

    return {
      status: response.statusCode,
      headers,
      body: Buffer.concat(chunks),
      location: headers.location ?? null,
    }
  } catch (error) {
    if (error instanceof AgentToolExecutionError) throw error
    if (signal.aborted) {
      throw new AgentToolExecutionError({
        code: 'WEB_FETCH_ABORTED',
        message: 'web_fetch 已取消',
        summary: '已取消',
      })
    }
    const message = error instanceof Error ? error.message : 'request failed'
    if (/timeout|Timeout/i.test(message)) {
      throw new AgentToolExecutionError({
        code: 'WEB_FETCH_TIMEOUT',
        message: 'web_fetch 请求超时',
        summary: '请求超时',
        audit: { finalUrl: url.href },
      })
    }
    throw new AgentToolExecutionError({
      code: 'WEB_FETCH_FAILED',
      message: `web_fetch 请求失败：${message}`,
      summary: '请求失败',
      audit: { finalUrl: url.href },
    })
  } finally {
    await client.close().catch(() => undefined)
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AgentToolExecutionError({
      code: 'WEB_FETCH_ABORTED',
      message: 'web_fetch 已取消',
      summary: '已取消',
    })
  }
}

function throwIfDeadline(deadline: number, now: () => number): void {
  if (now() > deadline) {
    throw new AgentToolExecutionError({
      code: 'WEB_FETCH_TIMEOUT',
      message: 'web_fetch 总超时',
      summary: '请求超时',
    })
  }
}
