import type { ChatAdapter } from '../adapters/chat-adapter'
import type { ChatModelCatalog, ChatModelDefinition } from './chat-model-catalog'
import { canAdvertiseAgentCapability } from './chat-model-capabilities'
import { ChatAdapterRegistry } from '../adapters/chat-adapter.registry'
import type { ImageAdapter } from '../image/adapters/image-adapter'
import { ImageAdapterRegistry } from '../image/adapters/image-adapter.registry'
import { ModelsController } from './models.controller'
import type { ProviderHealthService } from './provider-health.service'

function adapter(id: ChatAdapter['id']): ChatAdapter {
  return {
    id,
    resolvedModel: `${id}-model`,
    stream: jest.fn(),
  }
}

function imageAdapter(id: ImageAdapter['id']): ImageAdapter {
  return {
    id,
    resolvedModel: `${id}-image-model`,
    submit: jest.fn(),
    getStatus: jest.fn(),
    download: jest.fn(),
  }
}

describe('ModelsController', () => {
  const providerHealth = {
    getStatus: jest.fn(async (provider: string) =>
      provider === 'qwen' ? ('healthy' as const) : ('unhealthy' as const),
    ),
  } as unknown as ProviderHealthService

  it('returns only enabled public aliases with their passive health summary', async () => {
    const controller = new ModelsController(
      new ChatAdapterRegistry([adapter('qwen'), adapter('deepseek')]),
      {
        list: () => [
          {
            id: 'qwen-plus',
            provider: 'qwen',
            upstreamModelId: 'qwen-plus',
            displayName: 'Qwen Plus',
          },
          {
            id: 'deepseek-v4',
            provider: 'deepseek',
            upstreamModelId: 'deepseek-v4',
            displayName: 'DeepSeek V4',
          },
        ],
      } as unknown as ChatModelCatalog,
      providerHealth,
      new ImageAdapterRegistry([imageAdapter('mock')]),
    )

    await expect(controller.list()).resolves.toEqual([
      {
        id: 'qwen-plus',
        alias: 'qwen',
        modelId: 'qwen-plus',
        capabilities: ['chat', 'prompt', 'agent'],
        displayName: 'Qwen Plus',
        enabled: true,
        configured: true,
        health: 'healthy',
      },
      {
        id: 'deepseek-v4',
        alias: 'deepseek',
        modelId: 'deepseek-v4',
        capabilities: ['chat', 'prompt', 'agent'],
        displayName: 'DeepSeek V4',
        enabled: true,
        configured: true,
        health: 'unhealthy',
      },
      {
        id: 'mock-image',
        alias: 'mock-image',
        modelId: 'mock-image-model',
        capabilities: ['image'],
        displayName: 'Mock Image',
        enabled: true,
        configured: true,
        health: 'unknown',
      },
    ])
  })

  it('advertises agent for configured real providers', () => {
    const model = {
      id: 'qwen3.7-plus',
      provider: 'qwen',
      upstreamModelId: 'qwen3.7-plus',
      displayName: 'Qwen',
      contextWindowTokens: 1_000_000,
    } satisfies ChatModelDefinition
    expect(
      canAdvertiseAgentCapability({
        modelId: model.id,
        provider: model.provider,
        providerConfigured: true,
      }),
    ).toBe(true)
  })
})
