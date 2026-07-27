import type { TextModelAlias } from '@supermind/sdk'

import deepseekLogo from './deepseek-color.png'
import kimiLogo from './kimi.webp'
import qwenLogo from './qwen-color.png'
import glmLogo from './zai.webp'

export interface ChatProviderBranding {
  /** 厂商 Logo 的静态资源地址；留空时展示 fallbackText。 */
  logoUrl: string | null
  fallbackText: string
}

/**
 * Chat 模型厂商视觉配置的唯一入口。
 *
 * 替换其他厂商 Logo 时，只需要填写对应的 logoUrl。
 */
export const CHAT_PROVIDER_BRANDING = {
  qwen: {
    logoUrl: qwenLogo.src,
    fallbackText: 'Q',
  },
  glm: {
    logoUrl: glmLogo.src,
    fallbackText: '智',
  },
  deepseek: {
    logoUrl: deepseekLogo.src,
    fallbackText: 'DS',
  },
  kimi: {
    logoUrl: kimiLogo.src,
    fallbackText: 'K',
  },
} satisfies Record<TextModelAlias, ChatProviderBranding>
