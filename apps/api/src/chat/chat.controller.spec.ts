import { EventEmitter } from 'node:events'

import type { ChatFinishReason } from '@supermind/sdk'
import type { Request, Response } from 'express'

import type { RequestLifecycleService } from '../request-lifecycle/request-lifecycle.service'
import { RequestLifecycleStartError } from '../request-lifecycle/request-lifecycle.service'
import type { RateLimitService } from '../rate-limit/rate-limit.service'
import type { ProviderHealthService } from './provider-health.service'
import type { ChatFailoverService } from './chat-failover.service'
import type { PricingService } from '../billing/pricing.service'
import type { ChatAdapter, ChatAdapterEvent } from './adapters/chat-adapter'
import { ChatAdapterError } from './adapters/chat-adapter'
import { ChatAdapterRegistry } from './adapters/chat-adapter.registry'
import { ChatController } from './chat.controller'
import type { ChatModelCatalog } from './chat-model-catalog'
import type { ChatCompletionRequestDto } from './dto/chat-completion-request.dto'

const requestId = '00000000-0000-4000-8000-000000000003'
const authenticatedUser = {
  id: '00000000-0000-4000-8000-000000000101',
  authProvider: 'GITHUB' as const,
  userName: 'octocat',
  avatarUrl: null,
}
const input: ChatCompletionRequestDto = {
  model: 'qwen',
  messages: [{ role: 'user', content: '完整消息' }],
  stream: true,
}

function httpDoubles() {
  const request = Object.assign(new EventEmitter(), {
    id: requestId,
    ip: '127.0.0.1',
  }) as unknown as Request & { id: string }
  const writes: string[] = []
  const rawResponse = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    status: jest.fn(),
    set: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn((value: string) => {
      writes.push(value)
      return true
    }),
    end: jest.fn(),
  })
  rawResponse.status.mockImplementation(() => rawResponse)
  rawResponse.set.mockImplementation(() => rawResponse)
  rawResponse.end.mockImplementation(() => {
    rawResponse.writableEnded = true
    return rawResponse
  })

  return { request, response: rawResponse as unknown as Response, rawResponse, writes }
}

function adapterWith(events: readonly ChatAdapterEvent[], error?: Error) {
  const stream = jest.fn(() =>
    (async function* () {
      for (const event of events) yield event
      if (error) throw error
    })(),
  )
  const adapter: ChatAdapter = { id: 'mock', resolvedModel: 'mock-chat-v1', stream }
  return { adapter, stream }
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

function controllerFor(adapter: ChatAdapter, additionalAdapters: readonly ChatAdapter[] = []) {
  const registry = new ChatAdapterRegistry([adapter, ...additionalAdapters])
  const consumeChat = jest.fn().mockResolvedValue(undefined)
  const start = jest.fn().mockResolvedValue({
    id: 'log-1',
    requestId,
    status: 'PENDING',
    startedAt: new Date('2026-07-15T00:00:00.000Z'),
  })
  const finish = jest.fn().mockResolvedValue(undefined)
  const lifecycle = { start, finish } as unknown as RequestLifecycleService
  const rateLimit = { consumeChat } as unknown as RateLimitService
  const providerHealth = {
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  } as unknown as ProviderHealthService
  const failover = {
    resolve: jest.fn().mockReturnValue(undefined),
  } as unknown as ChatFailoverService
  const pricing = {
    calculate: jest.fn((_provider, usage) => usage),
  } as unknown as PricingService
  const controller = new ChatController(
    registry,
    {
      resolve: jest.fn((id: string) => {
        const provider = ['qwen', 'glm', 'deepseek', 'kimi'].includes(id) ? id : 'qwen'
        const selected = registry.has(provider as ChatAdapter['id'])
          ? registry.get(provider as ChatAdapter['id'])
          : adapter
        return {
          id,
          displayName: `${provider} Test`,
          provider,
          upstreamModelId: selected.resolvedModel,
        }
      }),
    } as unknown as ChatModelCatalog,
    lifecycle,
    rateLimit,
    providerHealth,
    failover,
    pricing,
  )
  return { consumeChat, controller, failover, finish, pricing, providerHealth, start }
}

function frameData(writes: readonly string[]) {
  return writes.map((frame) => frame.replace(/^data: /, '').trim())
}

describe('ChatController', () => {
  it('persists pending first, then streams delta, usage and exactly one DONE', async () => {
    const { adapter, stream } = adapterWith([
      { type: 'delta', content: '第一段' },
      { type: 'delta', content: '第二段' },
      {
        type: 'usage',
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, usageUnknown: false },
      },
      { type: 'finish', finishReason: 'stop' },
    ])
    const { consumeChat, controller, finish, pricing, start } = controllerFor(adapter)
    ;(pricing.calculate as jest.Mock).mockReturnValue({
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
      usageUnknown: false,
      priceVersion: 'mock-v1',
      inputCostCny: '0.00000000',
      outputCostCny: '0.00000000',
      estimatedCostCny: '0.00000000',
    })
    const { request, response, rawResponse, writes } = httpDoubles()

    await controller.create(
      { ...input, temperature: 0.7, topP: 0.9, maxTokens: 512 },
      request,
      response,
      authenticatedUser,
    )

    expect(consumeChat).toHaveBeenCalledWith('127.0.0.1')
    expect(consumeChat.mock.invocationCallOrder[0]).toBeLessThan(
      start.mock.invocationCallOrder[0] ?? 0,
    )
    expect(start.mock.invocationCallOrder[0]).toBeLessThan(stream.mock.invocationCallOrder[0] ?? 0)
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.7, topP: 0.9, maxTokens: 512 }),
    )
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: authenticatedUser.id,
        requestId,
        prompt: { messages: [{ role: 'user', content: '完整消息' }] },
        provider: 'qwen',
        resolvedModel: 'mock-chat-v1',
      }),
    )
    expect(rawResponse.flushHeaders).toHaveBeenCalledTimes(1)
    expect(rawResponse.end).toHaveBeenCalledTimes(1)
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        requestLogId: 'log-1',
        requestId,
        status: 'succeeded',
        usage: expect.objectContaining({
          inputTokens: 2,
          outputTokens: 3,
          totalTokens: 5,
          priceVersion: 'mock-v1',
          estimatedCostCny: '0.00000000',
        }),
      }),
    )

    const data = frameData(writes)
    expect(data.filter((value) => value === '[DONE]')).toHaveLength(1)
    expect(finish.mock.invocationCallOrder[0]).toBeLessThan(
      rawResponse.write.mock.invocationCallOrder.at(-1) ?? 0,
    )
    const payloads = data.slice(0, -1).map((value) => JSON.parse(value) as Record<string, unknown>)
    expect(payloads.map((payload) => payload.object)).toEqual([
      'chat.completion.chunk',
      'chat.completion.chunk',
      'chat.completion.chunk',
      'chat.completion.usage',
    ])
    expect(payloads[3]).toMatchObject({
      request_id: requestId,
      usage: {
        prompt_tokens: 2,
        completion_tokens: 3,
        total_tokens: 5,
        aigateway: { estimated_cost_cny: '0.00000000', usage_unknown: false },
      },
    })
  })

  it('does not persist or invoke an adapter when rate limiting rejects the request', async () => {
    const { adapter, stream } = adapterWith([])
    const { consumeChat, controller, start } = controllerFor(adapter)
    consumeChat.mockRejectedValue(new Error('rate limited'))
    const { request, response, rawResponse } = httpDoubles()

    await expect(controller.create(input, request, response, authenticatedUser)).rejects.toThrow(
      'rate limited',
    )

    expect(start).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
    expect(rawResponse.flushHeaders).not.toHaveBeenCalled()
  })

  it.each([
    ['qwen', 'qwen-plus-real'],
    ['kimi', 'kimi-k2.6-real'],
  ] as const)(
    'prefers the requested %s adapter and persists its resolved model',
    async (adapterId, resolvedModel) => {
      const { adapter: mock, stream: mockStream } = adapterWith([])
      const providerStream = jest.fn(() =>
        (async function* () {
          yield {
            type: 'usage' as const,
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, usageUnknown: false },
          }
          yield { type: 'finish' as const, finishReason: 'stop' as const }
        })(),
      )
      const realAdapter: ChatAdapter = {
        id: adapterId,
        resolvedModel,
        stream: providerStream,
      }
      const { controller, providerHealth, start } = controllerFor(mock, [realAdapter])
      const { request, response } = httpDoubles()

      await controller.create({ ...input, model: adapterId }, request, response, authenticatedUser)

      expect(providerStream).toHaveBeenCalledWith(
        expect.objectContaining({ modelAlias: adapterId, resolvedModel }),
      )
      expect(mockStream).not.toHaveBeenCalled()
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({ provider: adapterId, resolvedModel }),
      )
      expect(providerHealth.recordSuccess).toHaveBeenCalledWith(adapterId, expect.any(Number))
    },
  )

  it.each([
    [503, true],
    [400, false],
  ] as const)(
    'classifies provider HTTP %s failures for passive health',
    async (statusCode, affectsHealth) => {
      const { adapter: mock } = adapterWith([])
      const providerError = new ChatAdapterError('上游失败', {
        code: `UPSTREAM_${statusCode}`,
        retryable: statusCode >= 500,
        statusCode,
      })
      const realAdapter: ChatAdapter = {
        id: 'qwen',
        resolvedModel: 'qwen-real',
        stream: () => ({
          [Symbol.asyncIterator]: () => ({
            next: jest.fn().mockRejectedValue(providerError),
          }),
        }),
      }
      const { controller, providerHealth } = controllerFor(mock, [realAdapter])
      const { request, response } = httpDoubles()

      await controller.create(input, request, response, authenticatedUser)

      expect(providerHealth.recordFailure).toHaveBeenCalledWith('qwen', expect.any(Number), {
        code: `UPSTREAM_${statusCode}`,
        affectsHealth,
      })
    },
  )

  it('switches once to a configured fallback before the first content delta', async () => {
    const primaryError = new ChatAdapterError('主模型超时', {
      code: 'UPSTREAM_TIMEOUT',
      retryable: true,
    })
    const primary: ChatAdapter = {
      id: 'qwen',
      resolvedModel: 'qwen-real',
      stream: () => ({
        [Symbol.asyncIterator]: () => ({ next: jest.fn().mockRejectedValue(primaryError) }),
      }),
    }
    const fallback: ChatAdapter = {
      id: 'glm',
      resolvedModel: 'glm-real',
      stream: () =>
        (async function* () {
          yield { type: 'delta' as const, content: 'fallback 内容' }
          yield {
            type: 'usage' as const,
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, usageUnknown: false },
          }
          yield { type: 'finish' as const, finishReason: 'stop' as const }
        })(),
    }
    const { adapter: mock } = adapterWith([])
    const { controller, failover, finish } = controllerFor(mock, [primary, fallback])
    ;(failover.resolve as jest.Mock).mockReturnValue(fallback)
    const { request, response, writes } = httpDoubles()

    await controller.create(input, request, response, authenticatedUser)

    expect(frameData(writes).join('\n')).toContain('fallback 内容')
    expect(failover.resolve).toHaveBeenCalledTimes(1)
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'glm',
        resolvedModel: 'glm-real',
        failover: { from: 'qwen', to: 'glm', reason: 'UPSTREAM_TIMEOUT' },
      }),
    )
  })

  it('switches on an eligible 5xx before the first delta', async () => {
    const primary = failingAdapter(
      'qwen',
      new ChatAdapterError('上游不可用', {
        code: 'UPSTREAM_503',
        retryable: true,
        statusCode: 503,
      }),
    )
    const fallback: ChatAdapter = {
      id: 'glm',
      resolvedModel: 'glm-real',
      stream: () =>
        (async function* () {
          yield {
            type: 'usage' as const,
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, usageUnknown: false },
          }
          yield { type: 'finish' as const, finishReason: 'stop' as const }
        })(),
    }
    const { adapter: mock } = adapterWith([])
    const { controller, failover, finish } = controllerFor(mock, [primary, fallback])
    ;(failover.resolve as jest.Mock).mockReturnValue(fallback)
    const { request, response } = httpDoubles()

    await controller.create(input, request, response, authenticatedUser)

    expect(failover.resolve).toHaveBeenCalledWith('qwen', expect.any(ChatAdapterError), false)
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ failover: { from: 'qwen', to: 'glm', reason: 'UPSTREAM_503' } }),
    )
  })

  it('does not attempt a second failover when the fallback also fails', async () => {
    const primary = failingAdapter(
      'qwen',
      new ChatAdapterError('主模型超时', { code: 'UPSTREAM_TIMEOUT', retryable: true }),
    )
    const fallback = failingAdapter(
      'glm',
      new ChatAdapterError('fallback 超时', { code: 'UPSTREAM_TIMEOUT', retryable: true }),
    )
    const { adapter: mock } = adapterWith([])
    const { controller, failover, finish } = controllerFor(mock, [primary, fallback])
    ;(failover.resolve as jest.Mock).mockReturnValue(fallback)
    const { request, response } = httpDoubles()

    await controller.create(input, request, response, authenticatedUser)

    expect(failover.resolve).toHaveBeenCalledTimes(1)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('emits a normalized SSE error without DONE after the stream is open', async () => {
    const { adapter } = adapterWith(
      [{ type: 'delta', content: '部分内容' }],
      new ChatAdapterError('上游流中失败', {
        code: 'MOCK_STREAM_FAILURE',
        retryable: false,
      }),
    )
    const { controller, failover, finish } = controllerFor(adapter)
    ;(failover.resolve as jest.Mock).mockReturnValue(adapterWith([]).adapter)
    const { request, response, writes } = httpDoubles()

    await controller.create(input, request, response, authenticatedUser)

    const data = frameData(writes)
    expect(data).not.toContain('[DONE]')
    expect(JSON.parse(data.at(-1) ?? '{}')).toEqual({
      object: 'chat.completion.error',
      request_id: requestId,
      error: {
        requestId,
        code: 'MOCK_STREAM_FAILURE',
        message: '上游流中失败',
        retryable: false,
      },
    })
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: {
          code: 'MOCK_STREAM_FAILURE',
          message: '上游流中失败',
          details: { retryable: false },
        },
      }),
    )
    expect(failover.resolve).not.toHaveBeenCalled()
  })

  it('does not open the stream or invoke the adapter when persistence fails', async () => {
    const { adapter, stream } = adapterWith([])
    const { controller, start } = controllerFor(adapter)
    start.mockRejectedValue(new RequestLifecycleStartError(new Error('database unavailable')))
    const { request, response, rawResponse } = httpDoubles()

    await expect(
      controller.create(input, request, response, authenticatedUser),
    ).rejects.toBeInstanceOf(RequestLifecycleStartError)
    expect(rawResponse.flushHeaders).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
  })

  it('rejects adapter streams that omit usage', async () => {
    const finishReason: ChatFinishReason = 'stop'
    const { adapter } = adapterWith([
      { type: 'delta', content: '内容' },
      { type: 'finish', finishReason },
    ])
    const { controller } = controllerFor(adapter)
    const { request, response, writes } = httpDoubles()

    await controller.create(input, request, response, authenticatedUser)

    const error = JSON.parse(frameData(writes).at(-1) ?? '{}') as Record<string, unknown>
    expect(error).toMatchObject({
      object: 'chat.completion.error',
      error: { code: 'ADAPTER_PROTOCOL_ERROR', retryable: false },
    })
  })

  it('finalizes a disconnected stream as cancelled', async () => {
    let markStreamStarted!: () => void
    const streamStarted = new Promise<void>((resolve) => {
      markStreamStarted = resolve
    })
    const adapter: ChatAdapter = {
      id: 'mock',
      resolvedModel: 'mock-chat-v1',
      async *stream(adapterRequest) {
        markStreamStarted()
        await new Promise<void>((resolve, reject) => {
          void resolve
          adapterRequest.signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        })
        yield { type: 'finish', finishReason: 'stop' }
      },
    }
    const { controller, failover, finish } = controllerFor(adapter)
    const { request, response, rawResponse } = httpDoubles()

    const operation = controller.create(input, request, response, authenticatedUser)
    await streamStarted
    rawResponse.destroyed = true
    rawResponse.emit('close')
    await operation

    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled', requestLogId: 'log-1' }),
    )
    expect(failover.resolve).not.toHaveBeenCalled()
  })
})
