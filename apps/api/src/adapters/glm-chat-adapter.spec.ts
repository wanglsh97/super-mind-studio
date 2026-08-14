import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { OpenAICompatibleFetch } from './openai-compatible-chat.transport'
import { OpenAICompatibleChatTransport } from './openai-compatible-chat.transport'
import { GlmChatAdapter } from './glm-chat-adapter'
import { describeChatAdapterContract } from './testing/chat-adapter.contract'

const fixture = readFileSync(join(__dirname, 'testing/fixtures/glm-chat-success.sse'), 'utf8')

function adapter(fetch: OpenAICompatibleFetch): GlmChatAdapter {
  return new GlmChatAdapter(new OpenAICompatibleChatTransport({ fetch, timeoutMs: 1_000 }), {
    apiKey: 'sanitized-glm-key',
    baseUrl: 'https://glm.example/api/paas/v4',
    modelId: 'glm-fixture',
  })
}

describeChatAdapterContract({
  name: 'GLM',
  adapterId: 'glm',
  requestOverrides: { modelAlias: 'glm', resolvedModel: 'glm-fixture' },
  createSuccessCase: () => {
    const calls: Array<{ input: string; init?: RequestInit }> = []
    return {
      adapter: adapter(async (input, init) => {
        calls.push({ input: String(input), ...(init === undefined ? {} : { init }) })
        return new Response(fixture, { headers: { 'content-type': 'text/event-stream' } })
      }),
      expectedDeltas: ['你好', '，我是 GLM。'],
      expectedReasoning: ['先分析问候语。'],
      expectedUsage: {
        inputTokens: 9,
        outputTokens: 6,
        totalTokens: 15,
        cachedInputTokens: null,
        reasoningTokens: null,
        usageUnknown: false,
      },
      expectedFinishReason: 'stop',
      expectedProviderRequestId: 'glm-request-sanitized-1',
      assertRequest: () => {
        expect(calls[0]?.input).toBe('https://glm.example/api/paas/v4/chat/completions')
        expect(calls[0]?.init).toMatchObject({
          headers: { authorization: 'Bearer sanitized-glm-key' },
          body: JSON.stringify({
            model: 'glm-fixture',
            messages: [
              { role: 'system', content: 'You are concise.' },
              { role: 'user', content: 'Reply with a short greeting.' },
            ],
            stream: true,
            thinking: { type: 'enabled' },
            reasoning_effort: 'high',
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
      Promise.resolve(
        new Response('{}', { status: 503, headers: { 'x-request-id': 'glm-failed-1' } }),
      ),
    ),
    expectedError: {
      code: 'GLM_UPSTREAM_UNAVAILABLE',
      retryable: true,
      statusCode: 503,
      providerRequestId: 'glm-failed-1',
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

describe('GlmChatAdapter', () => {
  it.each([
    ['fast', 'disabled', undefined],
    ['balanced', 'enabled', 'high'],
    ['deep', 'enabled', 'max'],
  ] as const)(
    'maps %s thinking effort to GLM thinking controls',
    async (thinkingEffort, thinkingType, reasoningEffort) => {
      let body: Record<string, unknown> | undefined
      const subject = adapter(async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(fixture, { headers: { 'content-type': 'text/event-stream' } })
      })
      for await (const _event of subject.stream({
        requestId: '00000000-0000-4000-8000-000000000126',
        modelAlias: 'glm',
        resolvedModel: 'glm-fixture',
        messages: [{ role: 'user', content: 'test' }],
        thinkingEffort,
        signal: new AbortController().signal,
      })) {
        // Consume the stream so the request body is captured.
        void _event
      }
      expect(body).toHaveProperty('thinking.type', thinkingType)
      expect(body?.reasoning_effort).toBe(reasoningEffort)
    },
  )

  it('maps GLM sensitive completion to the platform content filter reason', async () => {
    const subject = adapter(
      async () =>
        new Response(
          'data: {"request_id":"glm-sensitive","choices":[{"delta":{"content":""},"finish_reason":"sensitive"}]}\n\n' +
            'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    )
    const events = []
    for await (const event of subject.stream({
      requestId: '00000000-0000-4000-8000-000000000026',
      modelAlias: 'glm',
      resolvedModel: 'glm-fixture',
      messages: [{ role: 'user', content: 'test' }],
      signal: new AbortController().signal,
    })) {
      events.push(event)
    }

    expect(events.at(-1)).toEqual({
      type: 'finish',
      finishReason: 'content_filter',
      providerRequestId: 'glm-sensitive',
    })
    expect(events[0]).toMatchObject({ type: 'usage', usage: { usageUnknown: true } })
  })
})
