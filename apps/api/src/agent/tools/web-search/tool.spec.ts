import { AgentToolRegistry } from '../agent-tool.registry'
import { createWebSearchTool } from './tool'

const mcpResult = (text: string) =>
  new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text }] },
    }),
  )

function createTool(fetchImpl: typeof fetch, maxOutputChars = 30_000) {
  return createWebSearchTool({
    providerMode: 'exa',
    timeoutMs: 1_000,
    maxResponseBytes: 100_000,
    maxOutputChars,
    fetchImpl,
  })
}

describe('web_search tool', () => {
  it('uses provider defaults and wraps successful content as untrusted data', async () => {
    const progress: string[] = []
    const fetchImpl = jest.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        params: {
          arguments: {
            query: 'latest AI news 2026',
            numResults: 8,
            livecrawl: 'fallback',
            type: 'auto',
          },
        },
      })
      return mcpResult('Title: Example\nURL: https://example.com')
    }) as typeof fetch
    const registry = new AgentToolRegistry([createTool(fetchImpl)])

    await expect(
      registry.execute(
        'web_search',
        { query: ' latest AI news 2026 ' },
        {
          toolCallId: 'call-1',
          runId: 'run-1',
          signal: new AbortController().signal,
          onProgress: (summary) => progress.push(summary),
        },
      ),
    ).resolves.toMatchObject({
      isError: false,
      summary: 'Exa 搜索已返回结果',
      content: expect.stringContaining('[UNTRUSTED EXTERNAL SEARCH RESULTS]'),
      audit: {
        provider: 'exa',
        responseChars: 39,
        truncated: false,
      },
    })
    expect(progress).toEqual(['正在搜索网页…'])
  })

  it('truncates model-visible provider content and records only bounded audit metadata', async () => {
    const fetchImpl = jest.fn(async () => mcpResult('x'.repeat(2_000))) as typeof fetch
    const result = await createTool(fetchImpl, 1_000).execute(
      { query: 'bounded result' },
      { toolCallId: 'call-2', signal: new AbortController().signal },
    )

    expect(result.content).toContain('…[search results truncated]')
    expect(result.audit).toEqual({
      provider: 'exa',
      durationMs: expect.any(Number),
      responseChars: 2_000,
      outputChars: 1_028,
      truncated: true,
    })
    expect(JSON.stringify(result.audit)).not.toContain('bounded result')
  })

  it.each([
    [{}, '缺少必填参数：query'],
    [{ query: '' }, '长度不得小于 1'],
    [{ query: 'x'.repeat(501) }, '长度不得大于 500'],
    [{ query: 'test', numResults: 1.5 }, '必须是整数'],
    [{ query: 'test', numResults: 11 }, '不得大于 10'],
    [{ query: 'test', type: 'unknown' }, '必须是允许的枚举值'],
    [{ query: 'test', extra: true }, '不允许的额外参数'],
  ])('rejects invalid args before making a request: %j', async (args, message) => {
    const fetchImpl = jest.fn(async () => mcpResult('not reached')) as typeof fetch
    const registry = new AgentToolRegistry([createTool(fetchImpl)])
    const result = await registry.execute('web_search', args, {
      toolCallId: 'call-invalid',
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ isError: true, content: expect.stringContaining(message) })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns normalized provider and cancellation errors without credentials', async () => {
    const fetchImpl = jest.fn(async () => new Response('limited', { status: 429 })) as typeof fetch
    const tool = createTool(fetchImpl)
    await expect(
      tool.execute(
        { query: 'test' },
        { toolCallId: 'call-error', signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({
      isError: true,
      summary: '网页搜索失败',
      content: '搜索服务返回 HTTP 429',
      audit: { errorCode: 'WEB_SEARCH_HTTP_ERROR' },
    })

    const cancelled = new AbortController()
    cancelled.abort()
    await expect(
      tool.execute({ query: 'test' }, { toolCallId: 'call-cancel', signal: cancelled.signal }),
    ).resolves.toMatchObject({
      isError: true,
      summary: '网页搜索已取消',
      audit: { errorCode: 'WEB_SEARCH_ABORTED' },
    })
  })
})
