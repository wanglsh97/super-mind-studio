import {
  EXA_WEB_SEARCH_MCP_URL,
  PARALLEL_WEB_SEARCH_MCP_URL,
  callWebSearchProvider,
  selectWebSearchProvider,
  type WebSearchProvider,
} from './web-search.providers'

const mcpResult = (text = 'result') =>
  new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text }] },
    }),
  )

function baseOptions(fetchImpl: typeof fetch) {
  return {
    identity: 'run-stable-1',
    runId: 'run-stable-1',
    args: {
      query: 'current TypeScript release',
      numResults: 3,
      livecrawl: 'preferred' as const,
      type: 'fast' as const,
      contextMaxCharacters: 4_000,
    },
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    maxResponseBytes: 16_384,
    fetchImpl,
  }
}

describe('web-search providers', () => {
  it('selects one stable auto provider for an identity', () => {
    const selected = selectWebSearchProvider('auto', 'run-stable-1')
    expect(['exa', 'parallel']).toContain(selected)
    expect(
      Array.from({ length: 5 }, () => selectWebSearchProvider('auto', 'run-stable-1')),
    ).toEqual(Array<WebSearchProvider>(5).fill(selected))
  })

  it('honors a fixed provider', () => {
    expect(selectWebSearchProvider('exa', 'ignored')).toBe('exa')
    expect(selectWebSearchProvider('parallel', 'ignored')).toBe('parallel')
  })

  it('maps the provider-neutral request to Exa without credentials by default', async () => {
    const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(EXA_WEB_SEARCH_MCP_URL)
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()
      expect(JSON.parse(String(init?.body))).toMatchObject({
        params: {
          name: 'web_search_exa',
          arguments: {
            query: 'current TypeScript release',
            numResults: 3,
            livecrawl: 'preferred',
            type: 'fast',
            contextMaxCharacters: 4_000,
          },
        },
      })
      return mcpResult('exa result')
    }) as typeof fetch

    await expect(
      callWebSearchProvider({
        ...baseOptions(fetchImpl),
        providerMode: 'exa',
      }),
    ).resolves.toEqual({ provider: 'exa', content: 'exa result' })
  })

  it('maps the provider-neutral request to Parallel without credentials by default', async () => {
    const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(PARALLEL_WEB_SEARCH_MCP_URL)
      expect(init?.headers).toMatchObject({ 'User-Agent': 'supermind-studio/0.1.0' })
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()
      expect(JSON.parse(String(init?.body))).toMatchObject({
        params: {
          name: 'web_search',
          arguments: {
            objective: 'current TypeScript release',
            search_queries: ['current TypeScript release'],
            session_id: 'run-stable-1',
          },
        },
      })
      return mcpResult('parallel result')
    }) as typeof fetch

    await expect(
      callWebSearchProvider({
        ...baseOptions(fetchImpl),
        providerMode: 'parallel',
      }),
    ).resolves.toEqual({ provider: 'parallel', content: 'parallel result' })
  })

  it('applies optional credentials only in provider-owned request metadata', async () => {
    const observed: Array<{ url: string; authorization?: string }> = []
    const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string>).Authorization
      observed.push({
        url: String(input),
        ...(authorization ? { authorization } : {}),
      })
      return mcpResult()
    }) as typeof fetch

    await callWebSearchProvider({
      ...baseOptions(fetchImpl),
      providerMode: 'exa',
      exaApiKey: 'exa secret/with spaces',
    })
    await callWebSearchProvider({
      ...baseOptions(fetchImpl),
      providerMode: 'parallel',
      parallelApiKey: 'parallel-secret',
    })

    expect(observed[0]).toEqual({
      url: `${EXA_WEB_SEARCH_MCP_URL}?exaApiKey=exa+secret%2Fwith+spaces`,
      authorization: undefined,
    })
    expect(observed[1]).toEqual({
      url: PARALLEL_WEB_SEARCH_MCP_URL,
      authorization: 'Bearer parallel-secret',
    })
  })

  it('does not expose credential-bearing URLs through request errors', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error(
        'fetch failed for https://mcp.exa.ai/mcp?exaApiKey=must-not-leak',
      )
    }) as typeof fetch
    await expect(
      callWebSearchProvider({
        ...baseOptions(fetchImpl),
        providerMode: 'exa',
        exaApiKey: 'must-not-leak',
      }),
    ).rejects.toMatchObject({
      code: 'WEB_SEARCH_REQUEST_FAILED',
      message: 'web_search 请求失败',
    })
  })
})
