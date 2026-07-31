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
        mockAvailable: false,
      }),
    ).toEqual(['chat', 'prompt', 'agent'])
  })

  it('advertises agent for Mock-backed catalog entries', () => {
    expect(
      canAdvertiseAgentCapability({
        modelId: 'qwen3.7-plus',
        provider: 'qwen',
        providerConfigured: false,
        mockAvailable: true,
      }),
    ).toBe(true)
    expect(
      resolveChatModelCapabilities({
        modelId: 'qwen3.7-plus',
        provider: 'qwen',
        providerConfigured: false,
        mockAvailable: true,
      }),
    ).toEqual(['chat', 'prompt', 'agent'])
  })

  it('advertises agent for configured real providers even when Mock is also present', () => {
    expect(
      canAdvertiseAgentCapability({
        modelId: 'qwen3.7-plus',
        provider: 'qwen',
        providerConfigured: true,
        mockAvailable: true,
      }),
    ).toBe(true)
  })

  it('does not advertise agent when neither provider nor Mock can serve', () => {
    expect(
      canAdvertiseAgentCapability({
        modelId: 'qwen3.7-plus',
        provider: 'qwen',
        providerConfigured: false,
        mockAvailable: false,
      }),
    ).toBe(false)
  })
})
