import type {
  ChatAdapter,
  ChatAdapterEvent,
  ChatAdapterRequest,
} from '../../src/adapters/chat-adapter'

/** 仅供离线脚本测试使用，不参与 NestJS Adapter 注册。 */
export class ScriptedChatFixture implements ChatAdapter {
  readonly id = 'qwen' as const
  readonly resolvedModel = 'qwen-scripted-fixture'

  async *stream(request: ChatAdapterRequest): AsyncIterable<ChatAdapterEvent> {
    const providerRequestId = `fixture-${request.requestId}`
    const hasToolResult = request.messages.some((message) => message.role === 'tool')

    if (!hasToolResult) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'call_1',
          name: 'web_fetch',
          arguments: { url: 'https://example.com/' },
        },
        providerRequestId,
      }
      yield {
        type: 'usage',
        usage: usageFor(request, 'web_fetch'),
        providerRequestId,
      }
      yield { type: 'finish', finishReason: 'tool_calls', providerRequestId }
      return
    }

    const answer = '已读取测试页面并完成总结。'
    yield { type: 'delta', content: answer, providerRequestId }
    yield { type: 'usage', usage: usageFor(request, answer), providerRequestId }
    yield { type: 'finish', finishReason: 'stop', providerRequestId }
  }
}

function usageFor(request: ChatAdapterRequest, output: string) {
  const inputLength = request.messages.reduce((sum, message) => sum + message.content.length, 0)
  const inputTokens = Math.max(1, Math.ceil(inputLength / 4))
  const outputTokens = Math.max(1, Math.ceil(output.length / 4))
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    usageUnknown: false,
  }
}
