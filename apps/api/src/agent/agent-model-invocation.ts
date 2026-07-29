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
import type { AgentModelInvocationRepository } from './agent-model-invocation.repository'

export interface AgentModelInvocationContext {
  userId: string
  agentRunId: string
  activeSkillNames?: () => readonly string[]
}

const UNKNOWN_USAGE: ChatAdapterUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
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
  invocations: AgentModelInvocationRepository,
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
      let provider: ChatAdapterId | undefined
      let resolvedModel: string | undefined
      let finished = false
      const skillNames = [...new Set(context.activeSkillNames?.() ?? [])]
      const toolNames = new Set(trailingToolNames(request.messages))

      try {
        for await (const event of base.invoke(request)) {
          if (event.type === 'text' || event.type === 'reasoning' || event.type === 'tool-call') {
            firstTokenAt ??= new Date()
          }
          if (event.type === 'tool-call') toolNames.add(event.toolCall.name)
          if (event.type === 'usage') {
            usage = event.usage
            provider = event.provider as ChatAdapterId
            resolvedModel = event.resolvedModel
          }
          if (event.type === 'finish') {
            finished = true
            provider = event.provider as ChatAdapterId
            resolvedModel = event.resolvedModel
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
            await invocations.save({
              requestId: request.requestId,
              requestLogId: started.id,
              agentRunId: context.agentRunId,
              userId: context.userId,
              status: 'succeeded',
              provider: event.provider,
              resolvedModel: event.resolvedModel,
              usage: usage ?? UNKNOWN_USAGE,
              startedAt: started.startedAt,
              completedAt: new Date(),
              skillNames,
              toolNames: [...toolNames],
            })
          }
          yield event
        }

        if (!finished) {
          const completedAt = new Date()
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
          await invocations.save({
            requestId: request.requestId,
            requestLogId: started.id,
            agentRunId: context.agentRunId,
            userId: context.userId,
            status: 'failed',
            ...(provider === undefined ? {} : { provider }),
            ...(resolvedModel === undefined ? {} : { resolvedModel }),
            usage: usage ?? UNKNOWN_USAGE,
            startedAt: started.startedAt,
            completedAt,
            skillNames,
            toolNames: [...toolNames],
          })
        }
      } catch (error) {
        if (!finished) {
          const aborted = request.signal.aborted
          const completedAt = new Date()
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
          await invocations.save({
            requestId: request.requestId,
            requestLogId: started.id,
            agentRunId: context.agentRunId,
            userId: context.userId,
            status: aborted ? 'cancelled' : 'failed',
            ...(provider === undefined ? {} : { provider }),
            ...(resolvedModel === undefined ? {} : { resolvedModel }),
            usage: usage ?? UNKNOWN_USAGE,
            startedAt: started.startedAt,
            completedAt,
            skillNames,
            toolNames: [...toolNames],
          })
        }
        throw error
      }
    },
  }
}

function trailingToolNames(messages: readonly { role: string; toolName?: string }[]): string[] {
  const names: string[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'tool') break
    if (message.toolName) names.push(message.toolName)
  }
  return names
}
