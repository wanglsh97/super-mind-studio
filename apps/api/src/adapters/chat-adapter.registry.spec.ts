import type { ChatAdapter } from './chat-adapter'
import {
  CHAT_ADAPTERS,
  ChatAdapterNotRegisteredError,
  ChatAdapterRegistry,
  DuplicateChatAdapterError,
} from './chat-adapter.registry'

function adapter(id: ChatAdapter['id']): ChatAdapter {
  return {
    id,
    resolvedModel: `${id}-model`,
    async *stream() {
      yield { type: 'finish', finishReason: 'stop' }
    },
  }
}

describe('ChatAdapterRegistry', () => {
  it('resolves registered adapters by stable adapter id', () => {
    const glm = adapter('glm')
    const qwen = adapter('qwen')
    const registry = new ChatAdapterRegistry([glm, qwen])

    expect(registry.get('glm')).toBe(glm)
    expect(registry.get('qwen')).toBe(qwen)
    expect(registry.has('deepseek')).toBe(false)
    expect(registry.list()).toEqual([glm, qwen])
  })

  it('rejects duplicate adapter ids at startup', () => {
    expect(() => new ChatAdapterRegistry([adapter('qwen'), adapter('qwen')])).toThrow(
      DuplicateChatAdapterError,
    )
  })

  it('fails explicitly when an adapter is not registered', () => {
    const registry = new ChatAdapterRegistry([])

    expect(() => registry.get('deepseek')).toThrow(ChatAdapterNotRegisteredError)
  })

  it('uses a stable Nest injection token', () => {
    expect(typeof CHAT_ADAPTERS).toBe('symbol')
  })
})
