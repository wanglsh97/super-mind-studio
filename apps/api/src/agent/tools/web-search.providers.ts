import { createHash } from 'node:crypto'

import { callWebSearchMcp } from './web-search-mcp.client'

export const EXA_WEB_SEARCH_MCP_URL = 'https://mcp.exa.ai/mcp'
export const PARALLEL_WEB_SEARCH_MCP_URL = 'https://search.parallel.ai/mcp'

export type WebSearchProvider = 'exa' | 'parallel'
export type WebSearchProviderMode = WebSearchProvider | 'auto'

export interface WebSearchProviderArgs {
  query: string
  numResults: number
  livecrawl: 'fallback' | 'preferred'
  type: 'auto' | 'fast' | 'deep'
  contextMaxCharacters?: number
}

export interface WebSearchProviderOptions {
  providerMode: WebSearchProviderMode
  identity: string
  runId?: string
  args: WebSearchProviderArgs
  signal: AbortSignal
  timeoutMs: number
  maxResponseBytes: number
  exaApiKey?: string
  parallelApiKey?: string
  fetchImpl?: typeof fetch
}

export interface WebSearchProviderResult {
  provider: WebSearchProvider
  content: string
}

export function selectWebSearchProvider(
  mode: WebSearchProviderMode,
  identity: string,
): WebSearchProvider {
  if (mode !== 'auto') return mode
  const firstByte = createHash('sha256').update(identity).digest()[0] ?? 0
  return firstByte % 2 === 0 ? 'exa' : 'parallel'
}

function exaUrl(apiKey?: string): string {
  if (!apiKey) return EXA_WEB_SEARCH_MCP_URL
  const url = new URL(EXA_WEB_SEARCH_MCP_URL)
  url.searchParams.set('exaApiKey', apiKey)
  return url.toString()
}

export async function callWebSearchProvider(
  options: WebSearchProviderOptions,
): Promise<WebSearchProviderResult> {
  const provider = selectWebSearchProvider(options.providerMode, options.identity)
  if (provider === 'exa') {
    const content = await callWebSearchMcp({
      url: exaUrl(options.exaApiKey),
      toolName: 'web_search_exa',
      arguments: {
        query: options.args.query,
        type: options.args.type,
        numResults: options.args.numResults,
        livecrawl: options.args.livecrawl,
        ...(options.args.contextMaxCharacters === undefined
          ? {}
          : { contextMaxCharacters: options.args.contextMaxCharacters }),
      },
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      maxResponseBytes: options.maxResponseBytes,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    })
    return { provider, content }
  }

  const content = await callWebSearchMcp({
    url: PARALLEL_WEB_SEARCH_MCP_URL,
    toolName: 'web_search',
    arguments: {
      objective: options.args.query,
      search_queries: [options.args.query],
      ...(options.runId ? { session_id: options.runId } : {}),
    },
    headers: {
      'User-Agent': 'supermind-studio/0.1.0',
      ...(options.parallelApiKey
        ? { Authorization: `Bearer ${options.parallelApiKey}` }
        : {}),
    },
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    maxResponseBytes: options.maxResponseBytes,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  })
  return { provider, content }
}
