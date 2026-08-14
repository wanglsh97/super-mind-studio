import { EventEmitter } from 'node:events'

import { ConfigService } from '@nestjs/config'
import type { Request } from 'express'

import type { PricingService } from '../billing/pricing.service'
import type { ChatAdapter } from '../adapters/chat-adapter'
import { ChatAdapterRegistry } from '../adapters/chat-adapter.registry'
import type { RateLimitService } from '../rate-limit/rate-limit.service'
import type { RequestLifecycleService } from '../request-lifecycle/request-lifecycle.service'
import { PromptController } from './prompt.controller'
import { PromptTemplateRegistry } from './prompt-template.registry'

const authenticatedUser = {
  id: '00000000-0000-4000-8000-000000000101',
  authProvider: 'GITHUB' as const,
  userName: 'octocat',
  avatarUrl: null,
}

function setup(
  error?: Error,
  configValues: Record<string, unknown> = {
    PROMPT_OPTIMIZER_MODEL: 'qwen',
    MOCK_PROVIDER_ENABLED: true,
  },
  registerAdapter = true,
) {
  const stream = jest.fn(() =>
    (async function* () {
      yield { type: 'delta' as const, content: '优化后的' }
      if (error) throw error
      yield { type: 'delta' as const, content: ' Prompt' }
      yield {
        type: 'usage' as const,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, usageUnknown: false },
      }
      yield { type: 'finish' as const, finishReason: 'stop' as const }
    })(),
  )
  const adapter: ChatAdapter = { id: 'qwen', resolvedModel: 'qwen-fixture-v1', stream }
  const consumeChat = jest.fn().mockResolvedValue(undefined)
  const rateLimit = { consumeChat } as unknown as RateLimitService
  const start = jest.fn().mockResolvedValue({
    id: 'log-1',
    requestId: '00000000-0000-4000-8000-000000000130',
    startedAt: new Date('2026-07-17T00:00:00.000Z'),
  })
  const finish = jest.fn().mockResolvedValue(undefined)
  const lifecycle = { start, finish } as unknown as RequestLifecycleService
  const calculate = jest.fn((_provider, usage) => ({
    ...usage,
    priceVersion: 'mock-v1',
    estimatedCostCny: '0.00000000',
  }))
  const pricing = { calculate } as unknown as PricingService
  const controller = new PromptController(
    new ConfigService(configValues),
    new ChatAdapterRegistry(registerAdapter ? [adapter] : []),
    new PromptTemplateRegistry(),
    lifecycle,
    rateLimit,
    pricing,
  )
  const request = Object.assign(new EventEmitter(), {
    id: '00000000-0000-4000-8000-000000000130',
    ip: '127.0.0.1',
  }) as unknown as Request & { id: string }
  return { calculate, consumeChat, controller, finish, request, start, stream }
}

describe('PromptController', () => {
  it.each([
    ['expand', '扩写'],
    ['simplify', '精简'],
    ['structure', '结构化'],
  ] as const)(
    'uses the versioned server template and complete lifecycle fields for %s mode',
    async (mode, instruction) => {
      const { calculate, consumeChat, controller, finish, request, start, stream } = setup()

      await expect(
        controller.optimize({ prompt: '帮我写代码', mode }, request, authenticatedUser),
      ).resolves.toEqual({
        requestId: request.id,
        model: 'qwen',
        optimizedPrompt: '优化后的 Prompt',
        templateVersion: '2026-07-v1',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          estimatedCostCny: '0.00000000',
          usageUnknown: false,
        },
      })
      expect(consumeChat).toHaveBeenCalledWith('127.0.0.1')
      expect(start.mock.invocationCallOrder[0]).toBeLessThan(
        stream.mock.invocationCallOrder[0] ?? 0,
      )
      expect(start).toHaveBeenCalledWith({
        userId: authenticatedUser.id,
        requestId: request.id,
        capability: 'prompt',
        prompt: {
          mode,
          templateVersion: '2026-07-v1',
          messages: [
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining(instruction),
            }),
            { role: 'user', content: '帮我写代码' },
          ],
        },
        modelAlias: 'qwen',
        provider: 'qwen',
        resolvedModel: 'qwen-fixture-v1',
        stream: false,
        clientIp: '127.0.0.1',
      })
      expect(stream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining(instruction),
            }),
            { role: 'user', content: '帮我写代码' },
          ],
        }),
      )
      expect(calculate).toHaveBeenCalledWith('qwen', expect.objectContaining({ totalTokens: 15 }))
      expect(finish).toHaveBeenCalledWith({
        requestLogId: 'log-1',
        requestId: request.id,
        startedAt: new Date('2026-07-17T00:00:00.000Z'),
        status: 'succeeded',
        provider: 'qwen',
        resolvedModel: 'qwen-fixture-v1',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          usageUnknown: false,
          priceVersion: 'mock-v1',
          estimatedCostCny: '0.00000000',
        },
      })
    },
  )

  it('finalizes a provider failure without returning a partial optimization', async () => {
    const { controller, finish, request } = setup(new Error('upstream failed'))

    await expect(
      controller.optimize({ prompt: '原始 Prompt', mode: 'expand' }, request, authenticatedUser),
    ).rejects.toThrow('upstream failed')
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: expect.objectContaining({ code: 'PROMPT_OPTIMIZATION_FAILED' }),
      }),
    )
  })

  it('returns an explicit error and never switches to another real model when the configured alias is disabled', async () => {
    const { controller, request, start, stream } = setup(
      undefined,
      { PROMPT_OPTIMIZER_MODEL: 'qwen' },
      false,
    )

    await expect(
      controller.optimize({ prompt: '原始 Prompt', mode: 'simplify' }, request, authenticatedUser),
    ).rejects.toMatchObject({
      model: 'qwen',
      status: 503,
    })
    expect(start).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
  })
})
