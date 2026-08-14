import type { ModelSummary } from '@supermind/sdk';
import { Controller, Get, Inject } from '@nestjs/common';

import { ChatAdapterRegistry } from '../adapters/chat-adapter.registry';
import { resolveChatModelCapabilities } from './chat-model-capabilities';
import { ChatModelCatalog } from './chat-model-catalog';
import { ProviderHealthService } from './provider-health.service';

@Controller('models')
export class ModelsController {
  constructor(
    @Inject(ChatAdapterRegistry) private readonly adapters: ChatAdapterRegistry,
    @Inject(ChatModelCatalog) private readonly chatModels: ChatModelCatalog,
    @Inject(ProviderHealthService) private readonly providerHealth: ProviderHealthService,
  ) {}

  @Get()
  async list(): Promise<ModelSummary[]> {
    const chatModels: ModelSummary[] = await Promise.all(
      this.chatModels.list().map(async (model) => {
        const configured = this.adapters.has(model.provider);
        return {
          id: model.id,
          alias: model.provider,
          modelId: model.upstreamModelId,
          capabilities: resolveChatModelCapabilities({
            modelId: model.id,
            provider: model.provider,
            providerConfigured: configured,
          }),
          displayName: model.displayName,
          enabled: true,
          configured,
          health: configured ? await this.providerHealth.getStatus(model.provider) : 'unknown',
        };
      }),
    );
    return chatModels;
  }
}
