import {
  WebSearchMcpError,
  callWebSearchMcp,
  parseWebSearchMcpResponse,
} from './web-search-mcp.client'

const jsonResult = (text: string) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text }] },
  })

describe('web-search MCP client', () => {
  it('parses direct JSON and SSE response forms', () => {
    expect(parseWebSearchMcpResponse(jsonResult('direct result'))).toBe('direct result')
    expect(
      parseWebSearchMcpResponse(`event: message\ndata: ${jsonResult('streamed result')}\n\n`),
    ).toBe('streamed result')
  })

  it('joins text blocks and ignores non-text content', () => {
    expect(
      parseWebSearchMcpResponse(
        JSON.stringify({
          result: {
            content: [
              { type: 'image', text: 'ignored' },
              { type: 'text', text: 'first' },
              { type: 'text', text: 'second' },
            ],
          },
        }),
      ),
    ).toBe('first\n\nsecond')
  })

  it.each([
    ['', 'WEB_SEARCH_EMPTY_RESULT'],
    ['not-json', 'WEB_SEARCH_EMPTY_RESULT'],
    ['data: {broken}', 'WEB_SEARCH_PROTOCOL_ERROR'],
    [
      JSON.stringify({ error: { code: -32_000, message: 'provider rejected' } }),
      'WEB_SEARCH_PROTOCOL_ERROR',
    ],
    [JSON.stringify({ result: { content: [] } }), 'WEB_SEARCH_EMPTY_RESULT'],
  ])('normalizes invalid payload %#', (body, code) => {
    try {
      parseWebSearchMcpResponse(body)
      throw new Error('expected parser to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(WebSearchMcpError)
      expect((error as WebSearchMcpError).code).toBe(code)
    }
  })

  it('sends a JSON-RPC tools/call request and returns text', async () => {
    const fetchImpl = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(init?.headers).toMatchObject({
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      })
      expect(JSON.parse(String(init?.body))).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'web_search', arguments: { query: 'test' } },
      })
      return new Response(jsonResult('found it'), {
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    await expect(
      callWebSearchMcp({
        url: 'https://search.example.test/mcp',
        toolName: 'web_search',
        arguments: { query: 'test' },
        headers: { Authorization: 'Bearer test-token' },
        signal: new AbortController().signal,
        timeoutMs: 1_000,
        maxResponseBytes: 1_024,
        fetchImpl,
      }),
    ).resolves.toBe('found it')
  })

  it('rejects non-success HTTP status without returning its body', async () => {
    const fetchImpl = jest.fn(
      async () => new Response('secret body', { status: 429 }),
    ) as typeof fetch
    await expect(
      callWebSearchMcp({
        url: 'https://search.example.test/mcp?apiKey=secret',
        toolName: 'web_search',
        arguments: {},
        signal: new AbortController().signal,
        timeoutMs: 1_000,
        maxResponseBytes: 1_024,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: 'WEB_SEARCH_HTTP_ERROR',
      message: '搜索服务返回 HTTP 429',
    })
  })

  it('stops reading a response above the configured byte limit', async () => {
    const fetchImpl = jest.fn(async () => new Response('x'.repeat(2_048))) as typeof fetch
    await expect(
      callWebSearchMcp({
        url: 'https://search.example.test/mcp',
        toolName: 'web_search',
        arguments: {},
        signal: new AbortController().signal,
        timeoutMs: 1_000,
        maxResponseBytes: 1_024,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'WEB_SEARCH_RESPONSE_TOO_LARGE' })
  })

  it('propagates caller cancellation', async () => {
    const caller = new AbortController()
    const fetchImpl = jest.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          })
        }),
    ) as typeof fetch
    const request = callWebSearchMcp({
      url: 'https://search.example.test/mcp',
      toolName: 'web_search',
      arguments: {},
      signal: caller.signal,
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
      fetchImpl,
    })
    caller.abort()
    await expect(request).rejects.toMatchObject({ code: 'WEB_SEARCH_ABORTED' })
  })

  it('normalizes request timeouts', async () => {
    const fetchImpl = jest.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          })
        }),
    ) as typeof fetch
    await expect(
      callWebSearchMcp({
        url: 'https://search.example.test/mcp',
        toolName: 'web_search',
        arguments: {},
        signal: new AbortController().signal,
        timeoutMs: 5,
        maxResponseBytes: 1_024,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'WEB_SEARCH_TIMEOUT' })
  })
})
