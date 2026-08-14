import {
  OpenAICompatibleChatTransport,
  OpenAICompatibleHttpError,
  OpenAICompatibleProtocolError,
  OpenAICompatibleTimeoutError,
} from './openai-compatible-chat.transport'
import type {
  OpenAICompatibleChatTransportEvent,
  OpenAICompatibleChatTransportRequest,
  OpenAICompatibleFetch,
} from './openai-compatible-chat.transport'

const requestBody = {
  model: 'provider-model',
  messages: [{ role: 'user', content: '你好' }],
  stream: true,
}

function request(
  signal: AbortSignal,
  overrides: Partial<OpenAICompatibleChatTransportRequest> = {},
): OpenAICompatibleChatTransportRequest {
  return {
    url: 'https://provider.example/v1/chat/completions',
    headers: { authorization: 'Bearer test-key' },
    body: requestBody,
    signal,
    ...overrides,
  }
}

function sseResponse(chunks: readonly string[], onCancel?: () => void): Response {
  const encoder = new TextEncoder()
  let index = 0

  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index]
        if (chunk === undefined) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(chunk))
        index += 1
      },
      cancel() {
        onCancel?.()
      },
    }),
    {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'x-request-id': 'provider-request-1',
      },
    },
  )
}

async function collect(
  events: AsyncIterable<OpenAICompatibleChatTransportEvent>,
): Promise<OpenAICompatibleChatTransportEvent[]> {
  const collected: OpenAICompatibleChatTransportEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

describe('OpenAICompatibleChatTransport', () => {
  it('rejects invalid timeout and connection limits', () => {
    expect(() => new OpenAICompatibleChatTransport({ timeoutMs: 0 })).toThrow(
      'timeoutMs must be a positive integer',
    )
    expect(() => new OpenAICompatibleChatTransport({ connections: 0 })).toThrow(
      'connections must be a positive integer',
    )
  })

  it('posts JSON and parses fragmented SSE through an injected Fetch client', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = []
    const fetchImplementation: OpenAICompatibleFetch = async (input, init) => {
      calls.push({ input: String(input), ...(init === undefined ? {} : { init }) })
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"第',
        '一段"}}]}\n\ndata: {"usage":{"total_tokens":5}}\n\ndata: [DONE]\n\n',
      ])
    }
    const transport = new OpenAICompatibleChatTransport({
      fetch: fetchImplementation,
      timeoutMs: 1_000,
    })
    const controller = new AbortController()

    await expect(collect(transport.stream(request(controller.signal)))).resolves.toEqual([
      {
        type: 'data',
        data: { choices: [{ delta: { content: '第一段' } }] },
        providerRequestId: 'provider-request-1',
      },
      {
        type: 'data',
        data: { usage: { total_tokens: 5 } },
        providerRequestId: 'provider-request-1',
      },
      { type: 'done', providerRequestId: 'provider-request-1' },
    ])
    expect(calls[0]?.input).toBe('https://provider.example/v1/chat/completions')
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
        authorization: 'Bearer test-key',
      },
      body: JSON.stringify(requestBody),
      signal: expect.any(AbortSignal),
    })
  })

  it('preserves upstream HTTP status, retryability, request ID and error body', async () => {
    const transport = new OpenAICompatibleChatTransport({
      fetch: async () =>
        new Response(JSON.stringify({ error: { code: 'provider_busy' } }), {
          status: 503,
          headers: { 'x-request-id': 'provider-failed-1' },
        }),
    })

    await expect(
      collect(transport.stream(request(new AbortController().signal))),
    ).rejects.toMatchObject({
      name: 'OpenAICompatibleHttpError',
      status: 503,
      retryable: true,
      providerRequestId: 'provider-failed-1',
      responseBody: { error: { code: 'provider_busy' } },
    } satisfies Partial<OpenAICompatibleHttpError>)
  })

  it('rejects invalid content types, invalid JSON and streams without DONE', async () => {
    const invalidContentType = new OpenAICompatibleChatTransport({
      fetch: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    })
    await expect(
      collect(invalidContentType.stream(request(new AbortController().signal))),
    ).rejects.toBeInstanceOf(OpenAICompatibleProtocolError)

    const invalidJson = new OpenAICompatibleChatTransport({
      fetch: async () => sseResponse(['data: not-json\n\ndata: [DONE]\n\n']),
    })
    await expect(
      collect(invalidJson.stream(request(new AbortController().signal))),
    ).rejects.toThrow('SSE data is not valid JSON')

    const missingDone = new OpenAICompatibleChatTransport({
      fetch: async () => sseResponse(['data: {"choices":[]}\n\n']),
    })
    await expect(
      collect(missingDone.stream(request(new AbortController().signal))),
    ).rejects.toThrow('ended without [DONE]')
  })

  it('aborts the injected Fetch request on timeout with a typed retryable error', async () => {
    let fetchSignal: AbortSignal | undefined
    const fetchImplementation: OpenAICompatibleFetch = (_input, init) => {
      fetchSignal = init?.signal as AbortSignal | undefined
      return new Promise((_resolve, reject) => {
        fetchSignal?.addEventListener('abort', () => reject(fetchSignal?.reason), { once: true })
      })
    }
    const transport = new OpenAICompatibleChatTransport({
      fetch: fetchImplementation,
      timeoutMs: 10,
    })

    await expect(
      collect(transport.stream(request(new AbortController().signal))),
    ).rejects.toMatchObject({
      name: 'OpenAICompatibleTimeoutError',
      timeoutMs: 10,
      retryable: true,
    } satisfies Partial<OpenAICompatibleTimeoutError>)
    expect(fetchSignal?.aborted).toBe(true)
  })

  it('propagates external cancellation instead of converting it to a timeout', async () => {
    const fetchImplementation: OpenAICompatibleFetch = (_input, init) => {
      const signal = init?.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    const transport = new OpenAICompatibleChatTransport({
      fetch: fetchImplementation,
      timeoutMs: 1_000,
    })
    const controller = new AbortController()
    const operation = collect(transport.stream(request(controller.signal)))

    controller.abort()

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('cancels the upstream response body when the consumer stops reading', async () => {
    const cancelled = jest.fn()
    let fetchSignal: AbortSignal | undefined
    const transport = new OpenAICompatibleChatTransport({
      fetch: async (_input, init) => {
        fetchSignal = init?.signal as AbortSignal
        const encoder = new TextEncoder()
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode('data: {"choices":[{"delta":{"content":"一段"}}]}\n\n'),
              )
            },
            cancel: cancelled,
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      },
    })
    const iterator = transport.stream(request(new AbortController().signal))[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'data' },
      done: false,
    })
    await iterator.return?.()

    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(fetchSignal?.aborted).toBe(true)
  })

  it('rejects non-positive or fractional timeout values', () => {
    expect(() => new OpenAICompatibleChatTransport({ timeoutMs: 0 })).toThrow(TypeError)
    expect(() => new OpenAICompatibleChatTransport({ timeoutMs: 1.5 })).toThrow(TypeError)
  })
})
