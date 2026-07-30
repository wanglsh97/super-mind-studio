import { AgentMcpClientError, createBoundedFetch, normalizeMcpToolResult } from './agent-mcp.client'

describe('createBoundedFetch', () => {
  it('refuses redirects so credentials cannot be downgraded to an insecure endpoint', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = jest.fn(async () => new Response('ok'))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      await createBoundedFetch(1_024, () => undefined)('https://mcp.example.test', {
        method: 'POST',
      })

      expect(fetchMock).toHaveBeenCalledWith(
        'https://mcp.example.test',
        expect.objectContaining({ method: 'POST', redirect: 'error' }),
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('normalizeMcpToolResult', () => {
  it('normalizes text, resource links and embedded text resources', () => {
    expect(
      normalizeMcpToolResult(
        {
          content: [
            { type: 'text', text: 'hello' },
            { type: 'resource_link', name: 'Docs', uri: 'https://example.test/docs' },
            {
              type: 'resource',
              resource: { uri: 'https://example.test/item', text: 'item body' },
            },
          ],
        },
        10_000,
      ),
    ).toEqual({
      content:
        'hello\n\n[Docs](https://example.test/docs)\n\nSource: https://example.test/item\nitem body',
      isError: false,
      contentBlockCount: 3,
      truncated: false,
    })
  })

  it('uses structured content when no text-like block exists and preserves remote error state', () => {
    expect(
      normalizeMcpToolResult(
        {
          content: [{ type: 'image', data: 'ignored', mimeType: 'image/png' }],
          structuredContent: { ok: false, reason: 'not found' },
          isError: true,
        },
        10_000,
      ),
    ).toMatchObject({
      content: '{"ok":false,"reason":"not found"}',
      isError: true,
      contentBlockCount: 1,
    })
  })

  it('truncates model-visible output by Unicode characters', () => {
    expect(
      normalizeMcpToolResult({ content: [{ type: 'text', text: '北京社保' }] }, 3),
    ).toMatchObject({
      content: '北京社\n…[MCP result truncated]',
      truncated: true,
    })
  })

  it('rejects empty or malformed results with a normalized protocol error', () => {
    for (const value of [{}, { content: [] }, { content: [{ type: 'image' }] }]) {
      expect(() => normalizeMcpToolResult(value, 1_000)).toThrow(AgentMcpClientError)
      try {
        normalizeMcpToolResult(value, 1_000)
      } catch (error) {
        expect(error).toMatchObject({ code: 'MCP_PROTOCOL_ERROR' })
      }
    }
  })
})
