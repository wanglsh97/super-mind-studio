import {
  callWebSearchProvider,
  type WebSearchProvider,
} from '../src/agent/tools/web-search.providers'

void main()

async function main(): Promise<void> {
  const providers: readonly WebSearchProvider[] = ['exa', 'parallel']
  const results: Array<{
    provider: WebSearchProvider
    responseChars: number
    preview: string
  }> = []

  for (const provider of providers) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const result = await callWebSearchProvider({
        providerMode: provider,
        identity: `anonymous-smoke-${provider}`,
        runId: `anonymous-smoke-${provider}`,
        args: {
          query: 'OpenAI official website',
          numResults: 2,
          livecrawl: 'fallback',
          type: 'fast',
          contextMaxCharacters: 2_000,
        },
        signal: controller.signal,
        timeoutMs: 25_000,
        maxResponseBytes: 2_097_152,
      })
      if (!result.content.trim()) throw new Error(`${provider} returned an empty result`)
      results.push({
        provider: result.provider,
        responseChars: result.content.length,
        preview: result.content.replace(/\s+/g, ' ').slice(0, 160),
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  console.log(
    JSON.stringify({
      mode: 'anonymous-free',
      requests: results.length,
      results,
    }),
  )
}
