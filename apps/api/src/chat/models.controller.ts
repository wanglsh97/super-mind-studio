import type { ImageModelAlias, ModelSummary } from '@supermind/sdk'
import { Controller, Get, Inject } from '@nestjs/common'

import { ImageAdapterRegistry } from '../image/adapters/image-adapter.registry'
import { ChatAdapterRegistry } from './adapters/chat-adapter.registry'
import { resolveChatModelCapabilities } from './chat-model-capabilities'
import { ChatModelCatalog } from './chat-model-catalog'
import { ProviderHealthService } from './provider-health.service'

@Controller('models')
export class ModelsController {
  constructor(
    @Inject(ChatAdapterRegistry) private readonly adapters: ChatAdapterRegistry,
    @Inject(ChatModelCatalog) private readonly chatModels: ChatModelCatalog,
    @Inject(ProviderHealthService) private readonly providerHealth: ProviderHealthService,
    @Inject(ImageAdapterRegistry) private readonly imageAdapters: ImageAdapterRegistry,
  ) {}

  @Get()
  async list(): Promise<ModelSummary[]> {
    const mockAvailable = this.adapters.has('mock')
    const chatModels: ModelSummary[] = await Promise.all(
      this.chatModels.list().map(async (model) => {
        const configured = this.adapters.has(model.provider)
        return {
          id: model.id,
          alias: model.provider,
          modelId: model.upstreamModelId,
          capabilities: resolveChatModelCapabilities({
            modelId: model.id,
            provider: model.provider,
            providerConfigured: configured,
            mockAvailable,
          }),
          displayName: model.displayName,
          enabled: true,
          configured,
          health: configured ? await this.providerHealth.getStatus(model.provider) : 'unknown',
        }
      }),
    )
    const imageAdapters = this.imageAdapters.list().filter((adapter) => adapter.id !== 'mock')
    const imageModels: ModelSummary[] =
      imageAdapters.length === 0 && this.imageAdapters.has('mock')
        ? [
            {
              id: 'wanxiang',
              alias: 'wanxiang',
              modelId: 'mock-image',
              capabilities: ['image'],
              displayName: '通义万相（Mock）',
              enabled: true,
              configured: false,
              health: 'unknown',
            },
          ]
        : imageAdapters.map((adapter) => ({
            id: adapter.id,
            alias: adapter.id as ImageModelAlias,
            modelId: adapter.resolvedModel,
            capabilities: ['image'],
            displayName: adapter.id === 'wanxiang' ? '通义万相' : '智谱 CogView',
            enabled: true,
            configured: true,
            health: 'unknown',
          }))

    return [...chatModels, ...imageModels]
  }
}
