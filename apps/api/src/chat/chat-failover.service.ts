import type { TextModelAlias } from '@supermind/sdk'
import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { ChatAdapter } from '../adapters/chat-adapter'
import { ChatAdapterError } from '../adapters/chat-adapter'
import { ChatAdapterRegistry } from '../adapters/chat-adapter.registry'

const FALLBACK_ENV = {
  qwen: 'QWEN_FALLBACK_ALIAS',
  glm: 'GLM_FALLBACK_ALIAS',
  deepseek: 'DEEPSEEK_FALLBACK_ALIAS',
  kimi: 'KIMI_FALLBACK_ALIAS',
} as const satisfies Record<TextModelAlias, string>

@Injectable()
export class ChatFailoverService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(ChatAdapterRegistry) private readonly adapters: ChatAdapterRegistry,
  ) {}

  resolve(primary: TextModelAlias, error: unknown, comparison: boolean): ChatAdapter | undefined {
    if (comparison || !isEligibleFailure(error)) return undefined

    const fallback = this.config.get<TextModelAlias>(FALLBACK_ENV[primary])
    if (!fallback || fallback === primary || !this.adapters.has(fallback)) return undefined
    return this.adapters.get(fallback)
  }
}

export function isEligibleFailure(error: unknown): error is ChatAdapterError {
  return (
    error instanceof ChatAdapterError &&
    error.retryable &&
    (error.code.includes('TIMEOUT') || error.statusCode === undefined || error.statusCode >= 500)
  )
}
