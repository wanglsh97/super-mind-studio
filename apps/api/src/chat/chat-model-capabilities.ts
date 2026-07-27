import type { Capability, TextModelAlias } from '@supermind/sdk'

export interface ChatCapabilityContext {
  modelId: string
  provider: TextModelAlias
  /** 该厂商真实 Adapter 是否已注册（API Key / 启用）。 */
  providerConfigured: boolean
  /** Mock Adapter 是否可用。 */
  mockAvailable: boolean
}

/**
 * 计算对外暴露的 Chat 模型 capabilities。
 *
 * 可服务的文本模型一律声明 `agent`。个别厂商若暂不支持 tool_call，由对应 Adapter 后续补齐，
 * 不在目录层用白名单把门禁掉。
 */
export function resolveChatModelCapabilities(context: ChatCapabilityContext): Capability[] {
  const capabilities: Capability[] = ['chat', 'prompt']
  if (canAdvertiseAgentCapability(context)) capabilities.push('agent')
  return capabilities
}

export function canAdvertiseAgentCapability(context: ChatCapabilityContext): boolean {
  return context.providerConfigured || context.mockAvailable
}
