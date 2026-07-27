import type { TextModelAlias } from '@supermind/sdk'

export const TEXT_MODEL_ALIASES = [
  'qwen',
  'glm',
  'deepseek',
  'kimi',
] as const satisfies readonly TextModelAlias[]

export const CHAT_ADAPTER_IDS = ['mock', ...TEXT_MODEL_ALIASES] as const

export type ChatAdapterId = (typeof CHAT_ADAPTER_IDS)[number]

export function isTextModelAlias(value: string): value is TextModelAlias {
  return (TEXT_MODEL_ALIASES as readonly string[]).includes(value)
}
