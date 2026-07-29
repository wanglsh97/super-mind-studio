import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { OpenAICompatibleFetch } from '../transports/openai-compatible-chat.transport'
import { OpenAICompatibleChatTransport } from '../transports/openai-compatible-chat.transport'
import { DeepSeekChatAdapter } from './deepseek-chat-adapter'
import { describeChatAdapterContract } from './testing/chat-adapter.contract'

const fixture = readFileSync(join(__dirname, 'testing/fixtures/deepseek-chat-success.sse'), 'utf8')

function adapter(fetch: OpenAICompatibleFetch): DeepSeekChatAdapter {
  return new DeepSeekChatAdapter(new OpenAICompatibleChatTransport({ fetch, timeoutMs: 1_000 }), {
    apiKey: 'sanitized-deepseek-key',
    baseUrl: 'https://deepseek.example',
    modelId: 'deepseek-fixture',
  })
}

describeChatAdapterContract({
  name: 'DeepSeek',
  adapterId: 'deepseek',
  requestOverrides: { modelAlias: 'deepseek', resolvedModel: 'deepseek-fixture' },
  createSuccessCase: () => {
    const calls: Array<{ input: string; init?: RequestInit }> = []
    return {
      adapter: adapter(async (input, init) => {
        calls.push({ input: String(input), ...(init === undefined ? {} : { init }) })
        return new Response(fixture, { headers: { 'content-type': 'text/event-stream' } })
      }),
      expectedDeltas: ['你好', '，我是 DeepSeek。'],
      expectedReasoning: ['先分析问候语。'],
      expectedUsage: { inputTokens: 10, outputTokens: 8, totalTokens: 18, usageUnknown: false },
      expectedFinishReason: 'stop',
      expectedProviderRequestId: 'deepseek-sanitized-1',
      assertRequest: () => {
        expect(calls[0]?.input).toBe('https://deepseek.example/chat/completions')
        expect(calls[0]?.init).toMatchObject({
          headers: { authorization: 'Bearer sanitized-deepseek-key' },
          body: JSON.stringify({
            model: 'deepseek-fixture',
            messages: [
              { role: 'system', content: 'You are concise.' },
              { role: 'user', content: 'Reply with a short greeting.' },
            ],
            stream: true,
            stream_options: { include_usage: true },
            thinking: { type: 'enabled' },
            reasoning_effort: 'max',
            temperature: 0.7,
            top_p: 0.8,
            max_tokens: 321,
          }),
        })
      },
    }
  },
  createErrorCase: () => ({
    adapter: adapter(async () =>
      Promise.resolve(new Response('{}', { status: 402, headers: { 'x-request-id': 'ds-402' } })),
    ),
    expectedError: {
      code: 'DEEPSEEK_INSUFFICIENT_BALANCE',
      retryable: false,
      statusCode: 402,
      providerRequestId: 'ds-402',
    },
  }),
  createCancellationCase: () => ({
    adapter: adapter(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    ),
  }),
})
