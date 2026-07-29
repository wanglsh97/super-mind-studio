import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { OpenAICompatibleFetch } from '../transports/openai-compatible-chat.transport'
import { OpenAICompatibleChatTransport } from '../transports/openai-compatible-chat.transport'
import { KimiChatAdapter } from './kimi-chat-adapter'
import { describeChatAdapterContract } from './testing/chat-adapter.contract'

const fixture = readFileSync(join(__dirname, 'testing/fixtures/kimi-chat-success.sse'), 'utf8')

function adapter(fetch: OpenAICompatibleFetch): KimiChatAdapter {
  return new KimiChatAdapter(new OpenAICompatibleChatTransport({ fetch, timeoutMs: 1_000 }), {
    apiKey: 'sanitized-kimi-key',
    baseUrl: 'https://kimi.example/v1',
    modelId: 'kimi-fixture',
  })
}

describeChatAdapterContract({
  name: 'Kimi',
  adapterId: 'kimi',
  requestOverrides: { modelAlias: 'kimi', resolvedModel: 'kimi-fixture' },
  createSuccessCase: () => {
    const calls: Array<{ input: string; init?: RequestInit }> = []
    return {
      adapter: adapter(async (input, init) => {
        calls.push({ input: String(input), ...(init === undefined ? {} : { init }) })
        return new Response(fixture, { headers: { 'content-type': 'text/event-stream' } })
      }),
      expectedDeltas: ['你好', '，我是 Kimi。'],
      expectedReasoning: ['先分析问候语。'],
      expectedUsage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
        cachedInputTokens: 0,
        reasoningTokens: null,
        usageUnknown: false,
      },
      expectedFinishReason: 'stop',
      expectedProviderRequestId: 'cmpl-kimi-sanitized-1',
      assertRequest: () => {
        expect(calls[0]?.input).toBe('https://kimi.example/v1/chat/completions')
        expect(calls[0]?.init).toMatchObject({
          headers: { authorization: 'Bearer sanitized-kimi-key' },
          body: JSON.stringify({
            model: 'kimi-fixture',
            messages: [
              { role: 'system', content: 'You are concise.' },
              { role: 'user', content: 'Reply with a short greeting.' },
            ],
            stream: true,
            stream_options: { include_usage: true },
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
        new Response(JSON.stringify({ error: { type: 'invalid_authentication_error' } }), {
          status: 401,
          headers: { 'x-request-id': 'kimi-failed-1' },
        }),
      ),
    ),
    expectedError: {
      code: 'KIMI_AUTHENTICATION_ERROR',
      retryable: false,
      statusCode: 401,
      providerRequestId: 'kimi-failed-1',
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

describe('KimiChatAdapter', () => {
  it.each([
    ['fast', 'low'],
    ['balanced', 'high'],
    ['deep', 'max'],
  ] as const)('maps %s thinking effort to Kimi K3 %s', async (thinkingEffort, expected) => {
    let body: Record<string, unknown> | undefined
    const subject = adapter(async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(fixture, { headers: { 'content-type': 'text/event-stream' } })
    })
    for await (const _event of subject.stream({
      requestId: '00000000-0000-4000-8000-000000000128',
      modelAlias: 'kimi',
      resolvedModel: 'kimi-k3',
      messages: [{ role: 'user', content: 'test' }],
      thinkingEffort,
      signal: new AbortController().signal,
    })) {
      // Consume the stream so the request body is captured.
      void _event
    }
    expect(body).toHaveProperty('reasoning_effort', expected)
    expect(body).not.toHaveProperty('thinking')
  })

  it('uses non-thinking provider defaults for K2.5 and K2.6 fixed sampling models', async () => {
    let body: Record<string, unknown> | undefined
    const kimi = new KimiChatAdapter(
      new OpenAICompatibleChatTransport({
        fetch: async (_input, init) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>
          return new Response(fixture, { headers: { 'content-type': 'text/event-stream' } })
        },
      }),
      {
        apiKey: 'sanitized',
        baseUrl: 'https://kimi.example/v1',
        modelId: 'kimi-k2.6',
      },
    )

    const events: unknown[] = []
    for await (const event of kimi.stream({
      requestId: '00000000-0000-4000-8000-000000000088',
      modelAlias: 'kimi',
      resolvedModel: 'kimi-k2.6',
      messages: [{ role: 'user', content: 'Reply briefly.' }],
      temperature: 0,
      topP: 0.8,
      maxTokens: 16,
      signal: new AbortController().signal,
    })) {
      events.push(event)
    }

    expect(events).not.toHaveLength(0)
    expect(body).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: 16 })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })

  it('rejects insecure Moonshot endpoints before sending credentials', () => {
    expect(
      () =>
        new KimiChatAdapter(new OpenAICompatibleChatTransport(), {
          apiKey: 'sanitized',
          baseUrl: 'http://kimi.example/v1',
          modelId: 'kimi-fixture',
        }),
    ).toThrow('must use HTTPS')
  })
})
