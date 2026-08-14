import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import { PricingService } from '../billing/pricing.service'
import { ImageModule } from '../image/image.module'
import { RedisModule } from '../redis/redis.module'
import type { ChatAdapter } from '../adapters/chat-adapter'
import { CHAT_ADAPTERS, ChatAdapterRegistry } from '../adapters/chat-adapter.registry'
import { DeepSeekChatAdapter } from '../adapters/deepseek-chat-adapter'
import { GlmChatAdapter } from '../adapters/glm-chat-adapter'
import { KimiChatAdapter } from '../adapters/kimi-chat-adapter'
import { QwenChatAdapter } from '../adapters/qwen-chat-adapter'
import { ChatFailoverService } from './chat-failover.service'
import { ChatModelCatalog } from './chat-model-catalog'
import { defaultUpstreamModelId } from './chat-models.config'
import { MODEL_INVOCATION_PORT } from './model-invocation.port'
import { ModelInvocationService } from './model-invocation.service'
import { ModelsController } from './models.controller'
import { ProviderHealthService } from './provider-health.service'
import { OpenAICompatibleChatTransport } from '../adapters/openai-compatible-chat.transport'

/**
 * Agent 与内部 Prompt 能力共享的模型网关。
 *
 * 目录仍位于 `chat/`，因为上游厂商协议是 Chat Completions；本模块不注册任何公开
 * `/chat` 产品接口，只暴露模型发现和 provider-neutral 的模型调用端口。
 */
@Module({
  imports: [ConfigModule, RedisModule, ImageModule],
  providers: [
    {
      provide: OpenAICompatibleChatTransport,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new OpenAICompatibleChatTransport({
          timeoutMs: config.get<number>('PROVIDER_TIMEOUT_MS', 60_000),
          connections: config.get<number>('PROVIDER_MAX_CONNECTIONS', 20),
        }),
    },
    {
      provide: CHAT_ADAPTERS,
      inject: [ConfigService, OpenAICompatibleChatTransport],
      useFactory: (
        config: ConfigService,
        transport: OpenAICompatibleChatTransport,
      ): readonly ChatAdapter[] => {
        const adapters: ChatAdapter[] = []
        if (config.get<boolean>('QWEN_ENABLED')) {
          adapters.push(
            new QwenChatAdapter(transport, {
              apiKey: config.getOrThrow<string>('QWEN_API_KEY'),
              baseUrl: config.getOrThrow<string>('QWEN_BASE_URL'),
              modelId: defaultUpstreamModelId('qwen'),
            }),
          )
        }
        if (config.get<boolean>('GLM_ENABLED')) {
          adapters.push(
            new GlmChatAdapter(transport, {
              apiKey: config.getOrThrow<string>('GLM_API_KEY'),
              baseUrl: config.getOrThrow<string>('GLM_BASE_URL'),
              modelId: defaultUpstreamModelId('glm'),
            }),
          )
        }
        if (config.get<boolean>('DEEPSEEK_ENABLED')) {
          adapters.push(
            new DeepSeekChatAdapter(transport, {
              apiKey: config.getOrThrow<string>('DEEPSEEK_API_KEY'),
              baseUrl: config.getOrThrow<string>('DEEPSEEK_BASE_URL'),
              modelId: defaultUpstreamModelId('deepseek'),
            }),
          )
        }
        if (config.get<boolean>('KIMI_ENABLED')) {
          adapters.push(
            new KimiChatAdapter(transport, {
              apiKey: config.getOrThrow<string>('KIMI_API_KEY'),
              baseUrl: config.getOrThrow<string>('KIMI_BASE_URL'),
              modelId: defaultUpstreamModelId('kimi'),
            }),
          )
        }
        return Object.freeze(adapters)
      },
    },
    ChatAdapterRegistry,
    ChatModelCatalog,
    ChatFailoverService,
    ProviderHealthService,
    PricingService,
    ModelInvocationService,
    { provide: MODEL_INVOCATION_PORT, useExisting: ModelInvocationService },
  ],
  controllers: [ModelsController],
  exports: [
    ChatAdapterRegistry,
    ChatModelCatalog,
    ProviderHealthService,
    ModelInvocationService,
    MODEL_INVOCATION_PORT,
    PricingService,
  ],
})
export class ModelGatewayModule {}
