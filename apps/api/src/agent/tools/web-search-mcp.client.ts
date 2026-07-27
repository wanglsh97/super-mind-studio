export type WebSearchMcpErrorCode =
  | 'WEB_SEARCH_ABORTED'
  | 'WEB_SEARCH_TIMEOUT'
  | 'WEB_SEARCH_HTTP_ERROR'
  | 'WEB_SEARCH_RESPONSE_TOO_LARGE'
  | 'WEB_SEARCH_PROTOCOL_ERROR'
  | 'WEB_SEARCH_EMPTY_RESULT'
  | 'WEB_SEARCH_REQUEST_FAILED'

export class WebSearchMcpError extends Error {
  constructor(
    readonly code: WebSearchMcpErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'WebSearchMcpError'
  }
}

export interface WebSearchMcpClientOptions {
  url: string
  toolName: string
  arguments: Record<string, unknown>
  signal: AbortSignal
  timeoutMs: number
  maxResponseBytes: number
  headers?: Readonly<Record<string, string>>
  fetchImpl?: typeof fetch
}

interface McpContentBlock {
  type?: unknown
  text?: unknown
}

interface McpEnvelope {
  result?: {
    content?: McpContentBlock[]
  }
  error?: {
    code?: unknown
    message?: unknown
  }
}

function parseEnvelope(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    throw new WebSearchMcpError('WEB_SEARCH_PROTOCOL_ERROR', '搜索服务返回了无效响应')
  }
  const envelope = value as McpEnvelope
  if (envelope.error) {
    const message =
      typeof envelope.error.message === 'string' && envelope.error.message.trim()
        ? envelope.error.message.trim().slice(0, 300)
        : '搜索服务返回 JSON-RPC 错误'
    throw new WebSearchMcpError('WEB_SEARCH_PROTOCOL_ERROR', message)
  }
  if (!Array.isArray(envelope.result?.content)) return undefined
  const texts = envelope.result.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => (block.text as string).trim())
    .filter(Boolean)
  return texts.length > 0 ? texts.join('\n\n') : undefined
}

function parseJsonPayload(payload: string): string | undefined {
  try {
    return parseEnvelope(JSON.parse(payload) as unknown)
  } catch (error) {
    if (error instanceof WebSearchMcpError) throw error
    throw new WebSearchMcpError('WEB_SEARCH_PROTOCOL_ERROR', '搜索服务返回了无效 JSON')
  }
}

export function parseWebSearchMcpResponse(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) {
    throw new WebSearchMcpError('WEB_SEARCH_EMPTY_RESULT', '搜索服务没有返回内容')
  }

  if (trimmed.startsWith('{')) {
    const direct = parseJsonPayload(trimmed)
    if (direct) return direct
  } else {
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      const result = parseJsonPayload(payload)
      if (result) return result
    }
  }

  throw new WebSearchMcpError('WEB_SEARCH_EMPTY_RESULT', '搜索服务没有返回文本结果')
}

async function readLimitedBody(
  response: Response,
  maxResponseBytes: number,
): Promise<string> {
  if (!response.body) {
    throw new WebSearchMcpError('WEB_SEARCH_EMPTY_RESULT', '搜索服务没有返回响应体')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let body = ''

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxResponseBytes) {
        await reader.cancel()
        throw new WebSearchMcpError(
          'WEB_SEARCH_RESPONSE_TOO_LARGE',
          `搜索服务响应超过 ${maxResponseBytes} 字节限制`,
        )
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    body += decoder.decode()
    return body
  } finally {
    reader.releaseLock()
  }
}

export async function callWebSearchMcp(options: WebSearchMcpClientOptions): Promise<string> {
  if (options.signal.aborted) {
    throw new WebSearchMcpError('WEB_SEARCH_ABORTED', 'web_search 已取消')
  }

  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort(options.signal.reason)
  options.signal.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('web_search timeout'))
  }, options.timeoutMs)

  try {
    const response = await (options.fetchImpl ?? fetch)(options.url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: options.toolName,
          arguments: options.arguments,
        },
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new WebSearchMcpError(
        'WEB_SEARCH_HTTP_ERROR',
        `搜索服务返回 HTTP ${response.status}`,
      )
    }
    return parseWebSearchMcpResponse(
      await readLimitedBody(response, options.maxResponseBytes),
    )
  } catch (error) {
    if (error instanceof WebSearchMcpError) throw error
    if (options.signal.aborted) {
      throw new WebSearchMcpError('WEB_SEARCH_ABORTED', 'web_search 已取消')
    }
    if (timedOut) {
      throw new WebSearchMcpError(
        'WEB_SEARCH_TIMEOUT',
        `web_search 在 ${options.timeoutMs}ms 后超时`,
      )
    }
    throw new WebSearchMcpError(
      'WEB_SEARCH_REQUEST_FAILED',
      error instanceof Error ? error.message.slice(0, 300) : 'web_search 请求失败',
    )
  } finally {
    clearTimeout(timeout)
    options.signal.removeEventListener('abort', abortFromCaller)
  }
}
