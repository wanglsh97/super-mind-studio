import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export type AgentMcpClientErrorCode =
  | 'MCP_ABORTED'
  | 'MCP_TIMEOUT'
  | 'MCP_RESPONSE_TOO_LARGE'
  | 'MCP_PROTOCOL_ERROR'
  | 'MCP_REMOTE_ERROR'
  | 'MCP_CONNECTION_FAILED'

export class AgentMcpClientError extends Error {
  constructor(
    readonly code: AgentMcpClientErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AgentMcpClientError'
  }
}

export interface AgentMcpRemoteTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface AgentMcpDiscoveryResult {
  serverName: string
  serverVersion: string
  tools: AgentMcpRemoteTool[]
}

export interface AgentMcpInvocationResult {
  content: string
  isError: boolean
  contentBlockCount: number
  truncated: boolean
}

export interface AgentMcpConnectionOptions {
  url: string
  bearerToken?: string
  signal: AbortSignal
  timeoutMs: number
  maxResponseBytes: number
}

export interface DiscoverAgentMcpToolsOptions extends AgentMcpConnectionOptions {
  maxTools: number
}

export interface CallAgentMcpToolOptions extends AgentMcpConnectionOptions {
  toolName: string
  arguments: Record<string, unknown>
  maxOutputChars: number
}

interface ConnectedClient {
  client: Client
  responseTooLarge: () => boolean
}

export class AgentMcpSdkClient {
  async discover(options: DiscoverAgentMcpToolsOptions): Promise<AgentMcpDiscoveryResult> {
    return this.withClient(options, async ({ client }) => {
      const tools: AgentMcpRemoteTool[] = []
      let cursor: string | undefined
      let pageCount = 0
      do {
        pageCount += 1
        if (pageCount > 20) {
          throw new AgentMcpClientError(
            'MCP_PROTOCOL_ERROR',
            'MCP tools/list 分页超过安全上限',
          )
        }
        const page = await client.listTools(
          cursor === undefined ? undefined : { cursor },
          requestOptions(options),
        )
        for (const tool of page.tools) {
          if (tools.length >= options.maxTools) {
            throw new AgentMcpClientError(
              'MCP_PROTOCOL_ERROR',
              `MCP tools/list 超过 ${options.maxTools} 个工具限制`,
            )
          }
          tools.push({
            name: tool.name,
            description: tool.description ?? '',
            inputSchema: tool.inputSchema as Record<string, unknown>,
          })
        }
        cursor = page.nextCursor
      } while (cursor)

      const version = client.getServerVersion()
      return {
        serverName: version?.name ?? 'unknown',
        serverVersion: version?.version ?? 'unknown',
        tools,
      }
    })
  }

  async callTool(options: CallAgentMcpToolOptions): Promise<AgentMcpInvocationResult> {
    return this.withClient(options, async ({ client }) => {
      const result = await client.callTool(
        { name: options.toolName, arguments: options.arguments },
        undefined,
        requestOptions(options),
      )
      return normalizeMcpToolResult(result, options.maxOutputChars)
    })
  }

  private async withClient<T>(
    options: AgentMcpConnectionOptions,
    operation: (connection: ConnectedClient) => Promise<T>,
  ): Promise<T> {
    if (options.signal.aborted) {
      throw new AgentMcpClientError('MCP_ABORTED', 'MCP 请求已取消')
    }

    let tooLarge = false
    const boundedFetch = createBoundedFetch(options.maxResponseBytes, () => {
      tooLarge = true
    })
    const transport = new StreamableHTTPClientTransport(new URL(options.url), {
      ...(options.bearerToken
        ? { requestInit: { headers: { Authorization: `Bearer ${options.bearerToken}` } } }
        : {}),
      fetch: boundedFetch,
      reconnectionOptions: {
        maxReconnectionDelay: 1_000,
        initialReconnectionDelay: 100,
        reconnectionDelayGrowFactor: 1,
        maxRetries: 0,
      },
    })
    const client = new Client(
      { name: 'super-mind-studio', version: '0.1.0' },
      { capabilities: {} },
    )

    try {
      // SDK v1's declaration is not exactOptionalPropertyTypes-safe although the runtime
      // transport implements the same interface.
      await client.connect(
        transport as unknown as Parameters<Client['connect']>[0],
        requestOptions(options),
      )
      return await operation({ client, responseTooLarge: () => tooLarge })
    } catch (error) {
      if (error instanceof AgentMcpClientError) throw error
      if (options.signal.aborted) {
        throw new AgentMcpClientError('MCP_ABORTED', 'MCP 请求已取消')
      }
      if (tooLarge) {
        throw new AgentMcpClientError(
          'MCP_RESPONSE_TOO_LARGE',
          `MCP 响应超过 ${options.maxResponseBytes} 字节限制`,
        )
      }
      if (isTimeoutError(error)) {
        throw new AgentMcpClientError(
          'MCP_TIMEOUT',
          `MCP 请求在 ${options.timeoutMs}ms 后超时`,
        )
      }
      throw new AgentMcpClientError('MCP_CONNECTION_FAILED', 'MCP 连接或请求失败')
    } finally {
      await client.close().catch(() => undefined)
    }
  }
}

function requestOptions(options: Pick<AgentMcpConnectionOptions, 'signal' | 'timeoutMs'>) {
  return {
    signal: options.signal,
    timeout: options.timeoutMs,
    maxTotalTimeout: options.timeoutMs,
  }
}

function createBoundedFetch(
  maxResponseBytes: number,
  onTooLarge: () => void,
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const response = await fetch(input, init)
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
      onTooLarge()
      await response.body?.cancel()
      throw new Error('MCP response too large')
    }
    if (!response.body) return response

    let bytes = 0
    const limiter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        if (bytes > maxResponseBytes) {
          onTooLarge()
          controller.error(new Error('MCP response too large'))
          return
        }
        controller.enqueue(chunk)
      },
    })
    return new Response(response.body.pipeThrough(limiter), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }) as typeof fetch
}

export function normalizeMcpToolResult(
  value: unknown,
  maxOutputChars: number,
): AgentMcpInvocationResult {
  if (!value || typeof value !== 'object' || !('content' in value)) {
    throw new AgentMcpClientError('MCP_PROTOCOL_ERROR', 'MCP 工具返回了无效结果')
  }
  const result = value as {
    content?: unknown
    structuredContent?: unknown
    isError?: unknown
  }
  if (!Array.isArray(result.content)) {
    throw new AgentMcpClientError('MCP_PROTOCOL_ERROR', 'MCP 工具结果缺少 content')
  }

  const blocks = result.content.flatMap((block): string[] => {
    if (!block || typeof block !== 'object') return []
    const record = block as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') return [record.text]
    if (record.type === 'resource_link' && typeof record.uri === 'string') {
      const label = typeof record.name === 'string' ? record.name : 'resource'
      return [`[${label}](${record.uri})`]
    }
    if (record.type === 'resource' && record.resource && typeof record.resource === 'object') {
      const resource = record.resource as Record<string, unknown>
      if (typeof resource.text === 'string') {
        return [
          `${typeof resource.uri === 'string' ? `Source: ${resource.uri}\n` : ''}${resource.text}`,
        ]
      }
    }
    return []
  })
  if (blocks.length === 0 && result.structuredContent !== undefined) {
    blocks.push(JSON.stringify(result.structuredContent))
  }
  const raw = blocks.join('\n\n').trim()
  if (!raw) {
    throw new AgentMcpClientError('MCP_PROTOCOL_ERROR', 'MCP 工具没有返回可用文本内容')
  }
  const characters = Array.from(raw)
  const truncated = characters.length > maxOutputChars
  const content = truncated
    ? `${characters.slice(0, maxOutputChars).join('')}\n…[MCP result truncated]`
    : raw
  return {
    content,
    isError: result.isError === true,
    contentBlockCount: result.content.length,
    truncated,
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.name === 'TimeoutError' ||
    error.message.toLowerCase().includes('timeout') ||
    error.message.toLowerCase().includes('timed out')
  )
}
