import {
  resolveChatModelCapabilities,
  canAdvertiseAgentCapability,
} from './chat-model-capabilities'

describe('chat model capabilities', () => {
  it('includes chat, prompt, and agent for configured real providers', () => {
    expect(
      resolveChatModelCapabilities({
        modelId: 'qwen3.7-plus',
        provider: 'qwen',
        providerConfigured: true,
      }),
    ).toEqual(['chat', 'prompt', 'agent'])
  })

  it('does not advertise agent when the real provider is not configured', () => {
    expect(
      canAdvertiseAgentCapability({
        modelId: 'qwen3.7-plus',
        provider: 'qwen',
        providerConfigured: false,
      }),
    ).toBe(false)
  })
})
