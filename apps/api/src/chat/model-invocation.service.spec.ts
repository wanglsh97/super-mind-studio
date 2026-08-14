import type { ChatAdapter, ChatAdapterEvent } from '../adapters/chat-adapter'
import { ChatAdapterError } from '../adapters/chat-adapter'
import { ChatAdapterRegistry } from '../adapters/chat-adapter.registry'
import type { ChatFailoverService } from './chat-failover.service'
import type { ChatModelCatalog } from './chat-model-catalog'
import { ModelInvocationService } from './model-invocation.service'
import type { ModelStreamEvent } from './model-invocation.port'
import type { ProviderHealthService } from './provider-health.service'

function adapterOf(
  id: ChatAdapter['id'],
  events: readonly ChatAdapterEvent[],
  error?: Error,
): ChatAdapter {
  return {
    id,
    resolvedModel: `${id}-real`,
    stream: jest.fn(() =>
      (async function* () {
        for (const event of events) yield event
        if (error) throw error
      })(),
    ),
  }
}

function failingAdapter(id: ChatAdapter['id'], error: Error): ChatAdapter {
  return {
    id,
    resolvedModel: `${id}-real`,
    stream: () => ({
      [Symbol.asyncIterator]: () => ({ next: jest.fn().mockRejectedValue(error) }),
    }),
  }
}

function serviceFor(
  primary: ChatAdapter,
  extras: readonly ChatAdapter[] = [],
  fallback?: ChatAdapter,
) {
  const registry = new ChatAdapterRegistry([primary, ...extras])
  const models = {
    resolve: jest.fn((id: string) => ({
      id,
      displayName: `${primary.id} Test`,
      provider: primary.id,
      upstreamModelId: primary.resolvedModel,
    })),
  } as unknown as ChatModelCatalog
  const failover = {
    resolve: jest.fn().mockReturnValue(fallback),
  } as unknown as ChatFailoverService
  const providerHealth = {
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  } as unknown as ProviderHealthService
  const service = new ModelInvocationService(models, registry, failover, providerHealth)
  return { service, failover, providerHealth, models }
}

async function collect(events: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const collected: ModelStreamEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

function baseRequest() {
  return {
    requestId: '00000000-0000-4000-8000-000000000900',
    modelId: 'qwen3.7-plus',
    messages: [{ role: 'user' as const, content: '你好' }],
    signal: new AbortController().signal,
  }
}

describe('ModelInvocationService', () => {
  it('maps adapter text/reasoning/tool-call/usage/finish into provider-neutral events', async () => {
    const primary = adapterOf('qwen', [
      { type: 'reasoning', content: '先思考' },
      { type: 'delta', content: '答案' },
      {
        type: 'tool-call',
        toolCall: { id: 't1', name: 'web_fetch', arguments: { url: 'https://a.test' } },
      },
      {
        type: 'usage',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, usageUnknown: false },
      },
      { type: 'finish', finishReason: 'tool_calls' },
    ])
    const { service } = serviceFor(primary)

    const events = await collect(service.invoke(baseRequest()))

    expect(events).toEqual([
      { type: 'reasoning', delta: '先思考' },
      { type: 'text', delta: '答案' },
      {
        type: 'tool-call',
        toolCall: { id: 't1', name: 'web_fetch', arguments: { url: 'https://a.test' } },
      },
      {
        type: 'usage',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, usageUnknown: false },
        provider: 'qwen',
        resolvedModel: 'qwen-real',
      },
      {
        type: 'finish',
        finishReason: 'tool_calls',
        provider: 'qwen',
        resolvedModel: 'qwen-real',
      },
    ])
  })

  it('forwards tools, toolChoice and sampling parameters to the adapter', async () => {
    const primary = adapterOf('qwen', [
      {
        type: 'usage',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, usageUnknown: true },
      },
      { type: 'finish', finishReason: 'stop' },
    ])
    const { service } = serviceFor(primary)

    await collect(
      service.invoke({
        ...baseRequest(),
        tools: [{ name: 'web_fetch', description: 'fetch', parameters: { type: 'object' } }],
        toolChoice: 'auto',
        temperature: 0.3,
        maxTokens: 128,
      }),
    )

    expect(primary.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{ name: 'web_fetch', description: 'fetch', parameters: { type: 'object' } }],
        toolChoice: 'auto',
        temperature: 0.3,
        maxTokens: 128,
      }),
    )
  })

  it('fails over once before the first content event and annotates the finish event', async () => {
    const primary = failingAdapter(
      'qwen',
      new ChatAdapterError('超时', { code: 'UPSTREAM_TIMEOUT', retryable: true }),
    )
    const fallback = adapterOf('glm', [
      { type: 'delta', content: 'fallback' },
      {
        type: 'usage',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, usageUnknown: false },
      },
      { type: 'finish', finishReason: 'stop' },
    ])
    const { service, failover } = serviceFor(primary, [fallback], fallback)

    const events = await collect(service.invoke(baseRequest()))

    expect(failover.resolve).toHaveBeenCalledTimes(1)
    expect(events[0]).toEqual({ type: 'text', delta: 'fallback' })
    expect(events.at(-1)).toEqual({
      type: 'finish',
      finishReason: 'stop',
      provider: 'glm',
      resolvedModel: 'glm-real',
      failover: { from: 'qwen', to: 'glm', reason: 'UPSTREAM_TIMEOUT' },
    })
  })

  it('does not fail over after a content event has been emitted', async () => {
    const primary = adapterOf(
      'qwen',
      [{ type: 'delta', content: '部分' }],
      new ChatAdapterError('流中失败', { code: 'MOCK_STREAM_FAILURE', retryable: false }),
    )
    const fallback = adapterOf('glm', [])
    const { service, failover } = serviceFor(primary, [fallback], fallback)

    await expect(collect(service.invoke(baseRequest()))).rejects.toBeInstanceOf(ChatAdapterError)
    expect(failover.resolve).not.toHaveBeenCalled()
  })

  it('does not fail over when allowFailover is false', async () => {
    const primary = failingAdapter(
      'qwen',
      new ChatAdapterError('超时', { code: 'UPSTREAM_TIMEOUT', retryable: true }),
    )
    const fallback = adapterOf('glm', [])
    const { service, failover } = serviceFor(primary, [fallback], fallback)

    await expect(
      collect(service.invoke({ ...baseRequest(), allowFailover: false })),
    ).rejects.toBeInstanceOf(ChatAdapterError)
    expect(failover.resolve).not.toHaveBeenCalled()
  })
})
