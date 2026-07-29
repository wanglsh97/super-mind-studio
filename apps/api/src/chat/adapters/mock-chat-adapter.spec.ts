import type { ChatAdapterEvent, ChatAdapterRequest } from './chat-adapter'
import { MockChatAdapter } from './mock-chat-adapter'
import { describeChatAdapterContract } from './testing/chat-adapter.contract'

function request(): ChatAdapterRequest {
  return {
    requestId: '00000000-0000-4000-8000-000000000001',
    modelAlias: 'qwen',
    resolvedModel: 'mock-chat-v1',
    messages: [{ role: 'user', content: 'abcd' }],
    signal: new AbortController().signal,
  }
}

async function collect(adapter: MockChatAdapter, input = request()): Promise<ChatAdapterEvent[]> {
  const events: ChatAdapterEvent[] = []
  for await (const event of adapter.stream(input)) events.push(event)
  return events
}

describeChatAdapterContract({
  name: 'Mock',
  adapterId: 'mock',
  requestOverrides: { resolvedModel: 'mock-chat-v1' },
  createSuccessCase: () => ({
    adapter: new MockChatAdapter({
      chunks: ['第一段', '第二段'],
      delayMs: 0,
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18, usageUnknown: false },
    }),
    expectedDeltas: ['第一段', '第二段'],
    expectedUsage: { inputTokens: 11, outputTokens: 7, totalTokens: 18, usageUnknown: false },
    expectedFinishReason: 'stop',
    expectedProviderRequestId: 'mock-00000000-0000-4000-8000-000000000077',
    assertRequest: (input) => {
      expect(input).toMatchObject({
        modelAlias: 'qwen',
        resolvedModel: 'mock-chat-v1',
        temperature: 0.7,
        topP: 0.8,
        maxTokens: 321,
      })
    },
  }),
  createErrorCase: () => ({
    adapter: new MockChatAdapter({
      chunks: ['never emitted'],
      delayMs: 0,
      failure: { phase: 'before-first-delta', code: 'MOCK_CONTRACT_FAILURE' },
    }),
    expectedError: {
      code: 'MOCK_CONTRACT_FAILURE',
      retryable: true,
      statusCode: 503,
      providerRequestId: 'mock-00000000-0000-4000-8000-000000000077',
    },
  }),
  createCancellationCase: () => ({
    adapter: new MockChatAdapter({ chunks: ['never emitted'], delayMs: 1_000 }),
  }),
})

describe('MockChatAdapter', () => {
  it('emits deterministic delayed deltas, usage and completion', async () => {
    const adapter = new MockChatAdapter({ chunks: ['12345'], delayMs: 10 })
    const startedAt = Date.now()

    const events = await collect(adapter)

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(8)
    expect(events).toEqual([
      {
        type: 'delta',
        content: '12345',
        providerRequestId: 'mock-00000000-0000-4000-8000-000000000001',
      },
      {
        type: 'usage',
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          usageUnknown: false,
        },
        providerRequestId: 'mock-00000000-0000-4000-8000-000000000001',
      },
      {
        type: 'finish',
        finishReason: 'stop',
        providerRequestId: 'mock-00000000-0000-4000-8000-000000000001',
      },
    ])
  })

  it('supports a configured failure after streaming has started', async () => {
    const adapter = new MockChatAdapter({
      chunks: ['first', 'never emitted'],
      delayMs: 0,
      failure: { phase: 'after-first-delta', retryable: false },
    })
    const iterator = adapter.stream(request())[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'delta', content: 'first' },
    })
    await expect(iterator.next()).rejects.toMatchObject({
      name: 'ChatAdapterError',
      code: 'MOCK_CHAT_FAILURE',
      retryable: false,
    })
  })

  it('rejects invalid deterministic configuration', () => {
    expect(() => new MockChatAdapter({ chunks: [], delayMs: 0 })).toThrow(TypeError)
    expect(() => new MockChatAdapter({ chunks: ['ok'], delayMs: -1 })).toThrow(TypeError)
  })
})
