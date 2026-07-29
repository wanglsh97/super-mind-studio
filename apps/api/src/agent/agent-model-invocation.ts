import type { Prisma } from '../generated/prisma/client'
import type { ChatAdapterId } from '../chat/chat.constants'
import type { ChatAdapterUsage } from '../chat/adapters/chat-adapter'
import type {
  ModelInvocationPort,
  ModelInvocationRequest,
  ModelStreamEvent,
} from '../chat/model-invocation.port'
import { PricingService } from '../billing/pricing.service'
import type { RequestLifecycleService } from '../request-lifecycle/request-lifecycle.service'

export interface AgentModelInvocationContext {
  userId: string
  agentRunId: string
}

const UNKNOWN_USAGE: ChatAdapterUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  usageUnknown: true,
}

/**
 * 用 RequestLog/BillingRecord 生命周期与计费包装底层 ModelInvocationPort。
 *
 * Agent 每次内部模型调用都独立创建 RequestLog(capability=agent, agentRunId=...) 并在
 * 终结时 upsert BillingRecord，保持与 Chat 相同的一对一账单不变量；失败/取消时按状态终结。
 */
export function createAgentModelInvocationPort(
  base: ModelInvocationPort,
  lifecycle: RequestLifecycleService,
  pricing: PricingService,
  context: AgentModelInvocationContext,
): ModelInvocationPort {
  return {
    async *invoke(request: ModelInvocationRequest): AsyncIterable<ModelStreamEvent> {
      const started = await lifecycle.start({
        userId: context.userId,
        requestId: request.requestId,
        capability: 'agent',
        prompt: {
          messages: request.messages,
          thinkingEffort: request.thinkingEffort ?? 'balanced',
        } as unknown as Prisma.InputJsonValue,
        modelAlias: request.modelId,
        stream: true,
        agentRunId: context.agentRunId,
      })

      let firstTokenAt: Date | undefined
      let usage: ChatAdapterUsage | undefined
      let finished = false

      try {
        for await (const event of base.invoke(request)) {
          if (event.type === 'text' || event.type === 'reasoning' || event.type === 'tool-call') {
            firstTokenAt ??= new Date()
          }
          if (event.type === 'usage') usage = event.usage
          if (event.type === 'finish') {
            finished = true
            const priced = pricing.calculate(
              event.provider as ChatAdapterId,
              usage ?? UNKNOWN_USAGE,
            )
            await lifecycle.finish({
              requestLogId: started.id,
              requestId: request.requestId,
              startedAt: started.startedAt,
              status: 'succeeded',
              provider: event.provider,
              resolvedModel: event.resolvedModel,
              usage: priced,
              ...(firstTokenAt === undefined ? {} : { firstTokenAt }),
              ...(event.providerRequestId === undefined
                ? {}
                : { providerRequestId: event.providerRequestId }),
              ...(event.failover === undefined ? {} : { failover: event.failover }),
            })
          }
          yield event
        }

        if (!finished) {
          await lifecycle.finish({
            requestLogId: started.id,
            requestId: request.requestId,
            startedAt: started.startedAt,
            status: 'failed',
            ...(firstTokenAt === undefined ? {} : { firstTokenAt }),
            ...(usage === undefined ? {} : { usage }),
            error: {
              code: 'AGENT_MODEL_STREAM_INCOMPLETE',
              message: '模型流在未产生 finish 前结束',
              details: { retryable: true },
            },
          })
        }
      } catch (error) {
        if (!finished) {
          const aborted = request.signal.aborted
          await lifecycle.finish({
            requestLogId: started.id,
            requestId: request.requestId,
            startedAt: started.startedAt,
            status: aborted ? 'cancelled' : 'failed',
            ...(firstTokenAt === undefined ? {} : { firstTokenAt }),
            ...(usage === undefined ? {} : { usage }),
            ...(aborted
              ? {}
              : {
                  error: {
                    code: 'AGENT_MODEL_ERROR',
                    message: error instanceof Error ? error.message : '模型调用失败',
                    details: { retryable: true },
                  },
                }),
          })
        }
        throw error
      }
    },
  }
}
