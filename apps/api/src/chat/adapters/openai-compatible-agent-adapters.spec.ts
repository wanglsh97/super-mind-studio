import type { TextModelAlias } from '@supermind/sdk'

import type { OpenAICompatibleFetch } from '../transports/openai-compatible-chat.transport'
import { OpenAICompatibleChatTransport } from '../transports/openai-compatible-chat.transport'
import type { ChatAdapter, ChatAdapterRequest } from './chat-adapter'
import { DeepSeekChatAdapter } from './deepseek-chat-adapter'
import { GlmChatAdapter } from './glm-chat-adapter'
import { KimiChatAdapter } from './kimi-chat-adapter'
import { describeAgentToolCallingContract } from './testing/agent-tool-calling.contract'

const FIRST_TURN = [
  `data: ${JSON.stringify({ id: 'tool-turn-1', request_id: 'tool-turn-1', choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'web_fetch', arguments: '{"url":"https://example' } }] }, finish_reason: null }] })}`,
  '',
  `data: ${JSON.stringify({ id: 'tool-turn-1', request_id: 'tool-turn-1', choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '.com/"}' } }] }, finish_reason: null }] })}`,
  '',
  'data: {"id":"tool-turn-1","request_id":"tool-turn-1","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
  '',
  'data: {"id":"tool-turn-1","request_id":"tool-turn-1","choices":[],"usage":{"prompt_tokens":20,"completion_tokens":8,"total_tokens":28}}',
  '',
  'data: [DONE]',
  '',
].join('\n')

const FOLLOW_UP = [
  'data: {"id":"tool-turn-2","request_id":"tool-turn-2","choices":[{"delta":{"content":"Example Domain summary"},"finish_reason":null}]}',
  '',
  'data: {"id":"tool-turn-2","request_id":"tool-turn-2","choices":[{"delta":{},"finish_reason":"stop"}]}',
  '',
  'data: {"id":"tool-turn-2","request_id":"tool-turn-2","choices":[],"usage":{"prompt_tokens":35,"completion_tokens":6,"total_tokens":41}}',
  '',
  'data: [DONE]',
  '',
].join('\n')

interface AdapterCase {
  name: string
  alias: TextModelAlias
  resolvedModel: string
  create(fetch: OpenAICompatibleFetch): ChatAdapter
}

const CASES: readonly AdapterCase[] = [
  {
    name: 'GLM',
    alias: 'glm',
    resolvedModel: 'glm-agent-fixture',
    create: (fetch) =>
      new GlmChatAdapter(new OpenAICompatibleChatTransport({ fetch, timeoutMs: 1_000 }), {
        apiKey: 'sanitized-glm-key',
        baseUrl: 'https://glm.example/api/paas/v4',
        modelId: 'glm-agent-fixture',
      }),
  },
  {
    name: 'DeepSeek',
    alias: 'deepseek',
    resolvedModel: 'deepseek-agent-fixture',
    create: (fetch) =>
      new DeepSeekChatAdapter(new OpenAICompatibleChatTransport({ fetch, timeoutMs: 1_000 }), {
        apiKey: 'sanitized-deepseek-key',
        baseUrl: 'https://deepseek.example',
        modelId: 'deepseek-agent-fixture',
      }),
  },
  {
    name: 'Kimi',
    alias: 'kimi',
    resolvedModel: 'kimi-agent-fixture',
    create: (fetch) =>
      new KimiChatAdapter(new OpenAICompatibleChatTransport({ fetch, timeoutMs: 1_000 }), {
        apiKey: 'sanitized-kimi-key',
        baseUrl: 'https://kimi.example/v1',
        modelId: 'kimi-agent-fixture',
      }),
  },
]

for (const adapterCase of CASES) {
  describeAgentToolCallingContract({
    name: adapterCase.name,
    adapterId: adapterCase.alias,
    modelAlias: adapterCase.alias,
    resolvedModel: adapterCase.resolvedModel,
    createAdapter: () => adapterCase.create(agentFetch()),
  })
}

describe.each(CASES)('$name Agent wire request', (adapterCase) => {
  it('sends tools and tool_choice through the shared OpenAI-compatible layer', async () => {
    const requests: Record<string, unknown>[] = []
    const adapter = adapterCase.create(agentFetch((body) => requests.push(body)))
    const request: ChatAdapterRequest = {
      requestId: '00000000-0000-4000-8000-0000000000d1',
      modelAlias: adapterCase.alias,
      resolvedModel: adapterCase.resolvedModel,
      messages: [{ role: 'user', content: 'Fetch https://example.com/' }],
      tools: [
        {
          name: 'web_fetch',
          description: 'Fetch a public URL.',
          parameters: {
            type: 'object',
            required: ['url'],
            properties: { url: { type: 'string' } },
          },
        },
      ],
      toolChoice: 'auto',
      signal: new AbortController().signal,
    }

    for await (const event of adapter.stream(request)) {
      // Consume the whole stream so the captured request and tool-call assembler are both verified.
      void event
    }

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      tools: [
        {
          type: 'function',
          function: {
            name: 'web_fetch',
            description: 'Fetch a public URL.',
            parameters: request.tools?.[0]?.parameters,
          },
        },
      ],
      tool_choice: 'auto',
    })
  })
})

function agentFetch(onRequest?: (body: Record<string, unknown>) => void): OpenAICompatibleFetch {
  return (_input, init) =>
    new Promise((resolve, reject) => {
      const signal = init?.signal as AbortSignal
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        onRequest?.(body)
        const messages = body.messages as Array<{ role?: string }>
        resolve(sse(messages.some((message) => message.role === 'tool') ? FOLLOW_UP : FIRST_TURN))
      }, 0)
      const onAbort = () => {
        clearTimeout(timer)
        reject(signal.reason)
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
}

function sse(body: string): Response {
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
}
