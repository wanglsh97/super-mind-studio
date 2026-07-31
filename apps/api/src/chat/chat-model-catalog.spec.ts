import type { ChatAdapter } from './adapters/chat-adapter'
import { ChatAdapterRegistry } from './adapters/chat-adapter.registry'
import { ChatModelCatalog } from './chat-model-catalog'
import { CHAT_MODELS, validateChatModels } from './chat-models.config'

function adapter(id: ChatAdapter['id'], resolvedModel: string): ChatAdapter {
  return { id, resolvedModel, stream: jest.fn() }
}

describe('ChatModelCatalog', () => {
  it('supports multiple selectable models through one provider adapter', () => {
    expect(() =>
      validateChatModels([
        ...CHAT_MODELS,
        {
          id: 'kimi-k3-turbo',
          displayName: 'Kimi K3 Turbo',
          provider: 'kimi',
          upstreamModelId: 'kimi-k3-turbo',
          contextWindowTokens: 1_000_000,
        },
      ]),
    ).not.toThrow()
  })

  it('rejects duplicate public model ids in the repository catalog', () => {
    expect(() => validateChatModels([...CHAT_MODELS, CHAT_MODELS[0]!])).toThrow(/重复/)
  })

  it('lists repository-owned community model names for enabled adapters', () => {
    const catalog = new ChatModelCatalog(
      new ChatAdapterRegistry([adapter('kimi', 'ignored-runtime-model')]),
    )

    expect(catalog.list()).toEqual([
      {
        id: 'kimi-k3',
        displayName: 'Kimi K3',
        provider: 'kimi',
        upstreamModelId: 'kimi-k3',
        contextWindowTokens: 1_000_000,
      },
    ])
    expect(catalog.resolve('kimi-k3')).toEqual({
      id: 'kimi-k3',
      displayName: 'Kimi K3',
      provider: 'kimi',
      upstreamModelId: 'kimi-k3',
      contextWindowTokens: 1_000_000,
    })
  })

  it('exposes the complete repository catalog in deterministic Mock mode', () => {
    const catalog = new ChatModelCatalog(new ChatAdapterRegistry([adapter('mock', 'mock-chat')]))

    expect(catalog.list()).toEqual(CHAT_MODELS)
    expect(catalog.resolve('qwen3.7-plus')?.contextWindowTokens).toBe(1_000_000)
  })

  it('resolveForAgent allows Mock-backed and configured real providers', () => {
    const mockCatalog = new ChatModelCatalog(
      new ChatAdapterRegistry([adapter('mock', 'mock-chat')]),
    )
    expect(mockCatalog.resolveForAgent('qwen3.7-plus')).toEqual(
      expect.objectContaining({ id: 'qwen3.7-plus', provider: 'qwen' }),
    )

    const realCatalog = new ChatModelCatalog(
      new ChatAdapterRegistry([adapter('mock', 'mock-chat'), adapter('qwen', 'qwen3.7-plus')]),
    )
    expect(realCatalog.resolveForAgent('qwen3.7-plus')).toEqual(
      expect.objectContaining({ id: 'qwen3.7-plus', provider: 'qwen' }),
    )
  })
})
