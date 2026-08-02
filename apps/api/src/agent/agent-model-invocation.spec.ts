import type { ModelInvocationPort } from '../chat/model-invocation.port'
import type { PricingService } from '../billing/pricing.service'
import type { RequestLifecycleService } from '../request-lifecycle/request-lifecycle.service'
import type { AgentModelInvocationRepository } from './agent-model-invocation.repository'
import { createAgentModelInvocationPort } from './agent-model-invocation'
import type { TelemetryService } from '../observability/telemetry.service'

describe('createAgentModelInvocationPort', () => {
  it('persists actual model usage with active Skill and pre/post Tool attribution', async () => {
    const base: ModelInvocationPort = {
      async *invoke() {
        yield {
          type: 'usage',
          usage: {
            inputTokens: 20,
            outputTokens: 8,
            totalTokens: 28,
            cachedInputTokens: 12,
            reasoningTokens: 4,
            usageUnknown: false,
          },
          provider: 'qwen',
          resolvedModel: 'qwen3.7-plus',
        }
        yield { type: 'tool-call', toolCall: { id: 'call-2', name: 'web_fetch', arguments: {} } }
        yield {
          type: 'finish',
          finishReason: 'tool_calls',
          provider: 'qwen',
          resolvedModel: 'qwen3.7-plus',
        }
      },
    }
    const finish = jest.fn()
    const lifecycle = {
      start: jest.fn().mockResolvedValue({
        id: 'request-log-1',
        requestId: '00000000-0000-4000-8000-000000000001',
        status: 'PENDING',
        startedAt: new Date('2026-07-29T00:00:00.000Z'),
      }),
      finish,
    } as unknown as RequestLifecycleService
    const pricing = {
      calculate: jest.fn((_provider, usage) => usage),
    } as unknown as PricingService
    const save = jest.fn()
    const invocations = { save } as unknown as AgentModelInvocationRepository
    const telemetry = {
      startSpan: jest.fn(() => ({
        setAttributes: jest.fn(),
        setStatus: jest.fn(),
        end: jest.fn(),
      })),
      addOutcome: jest.fn(),
      endSpan: jest.fn(),
    } as unknown as TelemetryService
    const port = createAgentModelInvocationPort(base, lifecycle, pricing, invocations, telemetry, {
      userId: 'user-1',
      agentRunId: 'run-1',
      activeSkillNames: () => ['research'],
    })

    for await (const event of port.invoke({
      requestId: '00000000-0000-4000-8000-000000000001',
      modelId: 'qwen3.7-plus',
      messages: [{ role: 'tool', content: 'result', toolName: 'web_search' }],
      signal: new AbortController().signal,
    })) {
      // Drain the invocation so lifecycle finalization and analytics persistence complete.
      void event
    }

    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'qwen', resolvedModel: 'qwen3.7-plus' }),
    )
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'succeeded',
        skillNames: ['research'],
        toolNames: expect.arrayContaining(['web_search', 'web_fetch']),
        usage: expect.objectContaining({ cachedInputTokens: 12, reasoningTokens: 4 }),
      }),
    )
  })
})
