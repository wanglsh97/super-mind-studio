import type { TextModelAlias } from '@supermind/sdk'
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'

import type { ChatAdapter, ChatAdapterEvent } from './adapters/chat-adapter'
import { ChatAdapterError } from './adapters/chat-adapter'
import { ChatAdapterRegistry } from './adapters/chat-adapter.registry'
import { ChatFailoverService } from './chat-failover.service'
import { ChatModelCatalog } from './chat-model-catalog'
import type {
  ModelInvocationPort,
  ModelInvocationRequest,
  ModelStreamEvent,
} from './model-invocation.port'
import { ProviderHealthService } from './provider-health.service'

interface ResolvedInvocationTarget {
  adapter: ChatAdapter
  provider: TextModelAlias
  resolvedModel: string
}

/**
 * ModelInvocationPort 的默认实现：复用 Chat 模型目录、Adapter registry、首事件前 failover
 * 与被动健康。它把 Adapter 事件映射为 provider-neutral 的统一事件流。
 *
 * 该服务只负责“一次模型调用 + 首事件前 failover + 事件映射”；RequestLog/BillingRecord
 * 生命周期由调用方（Chat 控制器保持原有逻辑；Agent run 服务按 capability=agent 关联
 * agentRunId）负责，以避免改变现有 Chat 行为。
 */
@Injectable()
export class ModelInvocationService implements ModelInvocationPort {
  constructor(
    @Inject(ChatModelCatalog) private readonly models: ChatModelCatalog,
    @Inject(ChatAdapterRegistry) private readonly adapters: ChatAdapterRegistry,
    @Inject(ChatFailoverService) private readonly failover: ChatFailoverService,
    @Inject(ProviderHealthService) private readonly providerHealth: ProviderHealthService,
  ) {}

  async *invoke(request: ModelInvocationRequest): AsyncIterable<ModelStreamEvent> {
    const target = this.resolveTarget(request.modelId)
    let contentEmitted = false

    const runAdapter = async function* (
      this: ModelInvocationService,
      adapter: ChatAdapter,
      provider: TextModelAlias,
      resolvedModel: string,
    ): AsyncIterable<ModelStreamEvent> {
      const startedAt = Date.now()
      let providerRequestId: string | undefined
      try {
        for await (const event of adapter.stream({
          requestId: request.requestId,
          modelAlias: provider,
          resolvedModel,
          messages: request.messages,
          signal: request.signal,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.topP === undefined ? {} : { topP: request.topP }),
          ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
          ...(request.thinkingEffort === undefined
            ? {}
            : { thinkingEffort: request.thinkingEffort }),
          ...(request.tools === undefined ? {} : { tools: request.tools }),
          ...(request.toolChoice === undefined ? {} : { toolChoice: request.toolChoice }),
        })) {
          if (event.providerRequestId !== undefined) providerRequestId = event.providerRequestId
          const mapped = this.mapEvent(event, provider, resolvedModel, providerRequestId)
          if (mapped === undefined) continue
          if (
            mapped.type === 'text' ||
            mapped.type === 'reasoning' ||
            mapped.type === 'tool-call'
          ) {
            contentEmitted = true
          }
          yield mapped
        }
        await this.providerHealth.recordSuccess(adapter.id, Date.now() - startedAt)
      } catch (error) {
        if (!request.signal.aborted && error instanceof ChatAdapterError) {
          await this.providerHealth.recordFailure(adapter.id, Date.now() - startedAt, {
            code: error.code,
            affectsHealth:
              error.retryable &&
              (error.statusCode === undefined ||
                error.statusCode >= 500 ||
                error.code.includes('TIMEOUT')),
          })
        }
        throw error
      }
    }.bind(this)

    try {
      yield* runAdapter(target.adapter, target.provider, target.resolvedModel)
    } catch (error) {
      if (contentEmitted || request.signal.aborted || request.allowFailover === false) throw error
      const fallback = this.failover.resolve(target.provider, error, false)
      if (!fallback) throw error

      const reason = error instanceof ChatAdapterError ? error.code : 'UPSTREAM_FAILURE'
      for await (const event of runAdapter(
        fallback,
        fallback.id as TextModelAlias,
        fallback.resolvedModel,
      )) {
        if (event.type === 'finish') {
          yield {
            ...event,
            failover: { from: target.provider, to: fallback.id, reason },
          }
          continue
        }
        yield event
      }
    }
  }

  private mapEvent(
    event: ChatAdapterEvent,
    provider: TextModelAlias,
    resolvedModel: string,
    providerRequestId: string | undefined,
  ): ModelStreamEvent | undefined {
    switch (event.type) {
      case 'delta':
        return { type: 'text', delta: event.content }
      case 'reasoning':
        return { type: 'reasoning', delta: event.content }
      case 'tool-call':
        return { type: 'tool-call', toolCall: event.toolCall }
      case 'usage':
        return { type: 'usage', usage: event.usage, provider, resolvedModel }
      case 'finish':
        return {
          type: 'finish',
          finishReason: event.finishReason,
          provider,
          resolvedModel,
          ...(providerRequestId === undefined ? {} : { providerRequestId }),
        }
      default: {
        const exhaustive: never = event
        void exhaustive
        return undefined
      }
    }
  }

  private resolveTarget(modelId: string): ResolvedInvocationTarget {
    const model = this.models.resolve(modelId)
    if (!model) throw new BadRequestException(`未知或未启用的模型 "${modelId}"`)
    const adapter = this.resolveAdapter(model.provider)
    return { adapter, provider: model.provider, resolvedModel: model.upstreamModelId }
  }

  private resolveAdapter(provider: TextModelAlias): ChatAdapter {
    if (this.adapters.has(provider)) return this.adapters.get(provider)
    if (this.adapters.has('mock')) return this.adapters.get('mock')
    throw new ServiceUnavailableException('当前没有可用的模型 Adapter')
  }
}
