import type { OpenAICompatibleFetch } from './openai-compatible-chat.transport'
import { OpenAICompatibleChatTransport } from './openai-compatible-chat.transport'
import type { ChatAdapterEvent, ChatAdapterRequest } from './chat-adapter'
import { QwenChatAdapter } from './qwen-chat-adapter'
import { describeAgentToolCallingContract } from './testing/agent-tool-calling.contract'

const FIRST_TURN = [
  `data: ${JSON.stringify({ id: 'qwen-tool-1', choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'web_fetch', arguments: '{"url":"https://example' } }] }, finish_reason: null }] })}`,
  '',
  `data: ${JSON.stringify({ id: 'qwen-tool-1', choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '.com/"}' } }] }, finish_reason: null }] })}`,
  '',
  'data: {"id":"qwen-tool-1","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
  '',
  'data: {"id":"qwen-tool-1","choices":[],"usage":{"prompt_tokens":20,"completion_tokens":8,"total_tokens":28}}',
  '',
  'data: [DONE]',
  '',
].join('\n')

const FOLLOW_UP = [
  'data: {"id":"qwen-tool-2","choices":[{"delta":{"content":"Example Domain summary"},"finish_reason":null}]}',
  '',
  'data: {"id":"qwen-tool-2","choices":[{"delta":{},"finish_reason":"stop"}]}',
  '',
  'data: {"id":"qwen-tool-2","choices":[],"usage":{"prompt_tokens":35,"completion_tokens":6,"total_tokens":41}}',
  '',
  'data: [DONE]',
  '',
].join('\n')

function sse(body: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'x-request-id': 'qwen-agent-fixture',
    },
  })
}

function qwenAgentAdapter(onRequest?: (body: Record<string, unknown>) => void): QwenChatAdapter {
  const fetch: OpenAICompatibleFetch = (_input, init) =>
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

  return new QwenChatAdapter(new OpenAICompatibleChatTransport({ fetch, timeoutMs: 1_000 }), {
    apiKey: 'sanitized-qwen-key',
    baseUrl: 'https://dashscope.example/compatible-mode/v1',
    modelId: 'qwen-agent-fixture',
  })
}

describeAgentToolCallingContract({
  name: 'Qwen',
  adapterId: 'qwen',
  modelAlias: 'qwen',
  resolvedModel: 'qwen-agent-fixture',
  createAdapter: () => qwenAgentAdapter(),
})

describe('QwenChatAdapter Agent wire request', () => {
  it('sends OpenAI-compatible tools and tool_choice to Qwen', async () => {
    const requests: Record<string, unknown>[] = []
    const adapter = qwenAgentAdapter((body) => requests.push(body))
    const request: ChatAdapterRequest = {
      requestId: '00000000-0000-4000-8000-0000000000c1',
      modelAlias: 'qwen',
      resolvedModel: 'qwen-agent-fixture',
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

    const events: ChatAdapterEvent[] = []
    for await (const event of adapter.stream(request)) events.push(event)

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
    expect(events.find((event) => event.type === 'tool-call')).toMatchObject({
      toolCall: {
        id: 'call_1',
        name: 'web_fetch',
        arguments: { url: 'https://example.com/' },
      },
    })
  })
})
