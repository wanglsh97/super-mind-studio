import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ChatAdapterEvent, ChatAdapterRequest } from './chat-adapter'
import { QwenChatAdapter } from './qwen-chat-adapter'
import { describeChatAdapterContract } from './testing/chat-adapter.contract'
import type { OpenAICompatibleFetch } from '../transports/openai-compatible-chat.transport'
import { OpenAICompatibleChatTransport } from '../transports/openai-compatible-chat.transport'

const successFixture = readFileSync(
  join(__dirname, 'testing/fixtures/qwen-chat-success.sse'),
  'utf8',
)

interface FetchCall {
  input: string
  init?: RequestInit
}

function sseResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'x-request-id': 'fixture-qwen-request-1',
    },
  })
}

function adapterWith(fetchImplementation: OpenAICompatibleFetch): QwenChatAdapter {
  return new QwenChatAdapter(
    new OpenAICompatibleChatTransport({ fetch: fetchImplementation, timeoutMs: 1_000 }),
    {
      apiKey: 'sanitized-qwen-key',
      baseUrl: 'https://dashscope.example/compatible-mode/v1',
      modelId: 'qwen-plus-fixture',
    },
  )
}

async function collect(
  adapter: QwenChatAdapter,
  input: ChatAdapterRequest,
): Promise<ChatAdapterEvent[]> {
  const events: ChatAdapterEvent[] = []
  for await (const event of adapter.stream(input)) events.push(event)
  return events
}

function request(): ChatAdapterRequest {
  return {
    requestId: '00000000-0000-4000-8000-000000000025',
    modelAlias: 'qwen',
    resolvedModel: 'qwen-plus-fixture',
    messages: [{ role: 'user', content: '你好' }],
    signal: new AbortController().signal,
  }
}

describeChatAdapterContract({
  name: 'Qwen',
  adapterId: 'qwen',
  requestOverrides: { modelAlias: 'qwen', resolvedModel: 'qwen3.7-max' },
  createSuccessCase: () => {
    const calls: FetchCall[] = []
    const adapter = adapterWith(async (input, init) => {
      calls.push({ input: String(input), ...(init === undefined ? {} : { init }) })
      return sseResponse(successFixture)
    })
    return {
      adapter,
      expectedDeltas: ['你好', '，我是千问。'],
      expectedReasoning: ['先分析问候语。'],
      expectedUsage: { inputTokens: 12, outputTokens: 7, totalTokens: 19, usageUnknown: false },
      expectedFinishReason: 'stop',
      expectedProviderRequestId: 'fixture-qwen-request-1',
      assertRequest: () => {
        expect(adapter.resolvedModel).toBe('qwen-plus-fixture')
        expect(calls).toHaveLength(1)
        expect(calls[0]?.input).toBe(
          'https://dashscope.example/compatible-mode/v1/chat/completions',
        )
        expect(calls[0]?.init).toMatchObject({
          method: 'POST',
          headers: {
            authorization: 'Bearer sanitized-qwen-key',
          },
          body: JSON.stringify({
            model: 'qwen3.7-max',
            messages: [
              { role: 'system', content: 'You are concise.' },
              { role: 'user', content: 'Reply with a short greeting.' },
            ],
            stream: true,
            stream_options: { include_usage: true },
            enable_thinking: true,
            temperature: 0.7,
            top_p: 0.8,
            max_tokens: 321,
          }),
        })
      },
    }
  },
  createErrorCase: () => ({
    adapter: adapterWith(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'rate_limit', message: 'sanitized' } }), {
          status: 429,
          headers: { 'x-request-id': 'fixture-qwen-failed-1' },
        }),
      ),
    ),
    expectedError: {
      code: 'QWEN_RATE_LIMITED',
      retryable: true,
      statusCode: 429,
      providerRequestId: 'fixture-qwen-failed-1',
    },
  }),
  createCancellationCase: () => ({
    adapter: adapterWith(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    ),
  }),
})

describe('QwenChatAdapter', () => {
  it.each([
    [400, 'QWEN_BAD_REQUEST', false],
    [401, 'QWEN_AUTHENTICATION_ERROR', false],
    [403, 'QWEN_ACCESS_DENIED', false],
    [404, 'QWEN_MODEL_NOT_FOUND', false],
    [408, 'QWEN_TIMEOUT', true],
    [429, 'QWEN_RATE_LIMITED', true],
    [503, 'QWEN_UPSTREAM_UNAVAILABLE', true],
  ])('maps HTTP %i to %s', async (status, code, retryable) => {
    const adapter = adapterWith(async () => new Response('{}', { status }))

    await expect(collect(adapter, request())).rejects.toMatchObject({
      name: 'ChatAdapterError',
      code,
      retryable,
      statusCode: status,
    })
  })

  it('emits explicit unknown usage when Qwen omits the optional usage chunk', async () => {
    const adapter = adapterWith(async () =>
      sseResponse(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\n' +
          'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}\n\n' +
          'data: [DONE]\n\n',
      ),
    )

    await expect(collect(adapter, request())).resolves.toEqual([
      { type: 'delta', content: 'ok', providerRequestId: 'fixture-qwen-request-1' },
      {
        type: 'usage',
        usage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          usageUnknown: true,
        },
        providerRequestId: 'fixture-qwen-request-1',
      },
      {
        type: 'finish',
        finishReason: 'stop',
        providerRequestId: 'fixture-qwen-request-1',
      },
    ])
  })

  it('rejects malformed usage and insecure provider endpoints', async () => {
    const malformed = adapterWith(async () =>
      sseResponse(
        'data: {"choices":[{"finish_reason":"stop"}]}\n\n' +
          'data: {"choices":[],"usage":{"prompt_tokens":-1,"completion_tokens":1,"total_tokens":0}}\n\n' +
          'data: [DONE]\n\n',
      ),
    )
    await expect(collect(malformed, request())).rejects.toMatchObject({
      code: 'QWEN_PROTOCOL_ERROR',
    })

    expect(
      () =>
        new QwenChatAdapter(new OpenAICompatibleChatTransport(), {
          apiKey: 'key',
          baseUrl: 'http://dashscope.example/v1',
          modelId: 'model',
        }),
    ).toThrow('must use HTTPS')
  })
})
