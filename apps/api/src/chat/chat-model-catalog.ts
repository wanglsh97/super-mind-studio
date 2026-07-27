import type { TextModelAlias } from '@supermind/sdk'
import { Inject, Injectable } from '@nestjs/common'

import { ChatAdapterRegistry } from './adapters/chat-adapter.registry'
import { canAdvertiseAgentCapability } from './chat-model-capabilities'
import { CHAT_MODELS } from './chat-models.config'

export interface ChatModelDefinition {
  id: string
  displayName: string
  provider: TextModelAlias
  upstreamModelId: string
  contextWindowTokens: number
}

@Injectable()
export class ChatModelCatalog {
  constructor(@Inject(ChatAdapterRegistry) private readonly adapters: ChatAdapterRegistry) {}

  list(): readonly ChatModelDefinition[] {
    return CHAT_MODELS.filter(
      ({ provider }) => this.adapters.has(provider) || this.adapters.has('mock'),
    )
  }

  resolve(id: string): ChatModelDefinition | undefined {
    return this.list().find((definition) => definition.id === id)
  }

  /** 仅启用且可服务的模型可创建 Agent thread。 */
  resolveForAgent(id: string): ChatModelDefinition | undefined {
    const model = this.resolve(id)
    if (!model) return undefined
    if (
      !canAdvertiseAgentCapability({
        modelId: model.id,
        provider: model.provider,
        providerConfigured: this.adapters.has(model.provider),
        mockAvailable: this.adapters.has('mock'),
      })
    ) {
      return undefined
    }
    return model
  }
}
