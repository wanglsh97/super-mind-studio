import { Inject, Injectable } from '@nestjs/common'

import type { ChatAdapterId } from '../chat/chat.constants'
import type { ChatAdapter } from './chat-adapter'

export const CHAT_ADAPTERS = Symbol('CHAT_ADAPTERS')

export class DuplicateChatAdapterError extends Error {
  constructor(readonly adapterId: ChatAdapterId) {
    super(`Chat adapter "${adapterId}" is registered more than once`)
    this.name = 'DuplicateChatAdapterError'
  }
}

export class ChatAdapterNotRegisteredError extends Error {
  constructor(readonly adapterId: ChatAdapterId) {
    super(`Chat adapter "${adapterId}" is not registered`)
    this.name = 'ChatAdapterNotRegisteredError'
  }
}

@Injectable()
export class ChatAdapterRegistry {
  private readonly adapters: ReadonlyMap<ChatAdapterId, ChatAdapter>

  constructor(@Inject(CHAT_ADAPTERS) adapters: readonly ChatAdapter[]) {
    const byId = new Map<ChatAdapterId, ChatAdapter>()

    for (const adapter of adapters) {
      if (byId.has(adapter.id)) throw new DuplicateChatAdapterError(adapter.id)
      byId.set(adapter.id, adapter)
    }

    this.adapters = byId
  }

  has(adapterId: ChatAdapterId): boolean {
    return this.adapters.has(adapterId)
  }

  get(adapterId: ChatAdapterId): ChatAdapter {
    const adapter = this.adapters.get(adapterId)
    if (!adapter) throw new ChatAdapterNotRegisteredError(adapterId)
    return adapter
  }

  list(): readonly ChatAdapter[] {
    return [...this.adapters.values()]
  }
}
