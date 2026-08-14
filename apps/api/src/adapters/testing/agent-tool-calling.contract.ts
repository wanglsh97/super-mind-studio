import type { TextModelAlias } from '@supermind/sdk'

import type { ChatAdapterId } from '../../chat/chat.constants'
import type { ChatAdapter, ChatAdapterEvent, ChatAdapterRequest } from '../chat-adapter'

/**
 * 面向支持 Agent tool-calling 的 Adapter 的统一 contract。
 *
 * 覆盖：首轮发出 web_fetch tool call（finish=tool_calls）、附带 tool result 的后续 turn
 * 产出最终文本答案（finish=stop）、以及取消传播。真实 provider 的 Adapter 在板块 4 复用
 * 同一 contract 以保证平台中立的 tool-calling 行为一致。
 */
export interface AgentToolCallingContractHarness {
  name: string
  adapterId: ChatAdapterId
  modelAlias: TextModelAlias
  resolvedModel: string
  /** 构造被测 Adapter（每个用例独立实例）。 */
  createAdapter(): ChatAdapter
}

const WEB_FETCH_TOOL = {
  name: 'web_fetch',
  description: 'Fetch a public URL and return extracted text.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
  },
} as const

function baseRequest(
  harness: AgentToolCallingContractHarness,
  signal: AbortSignal,
  messages: ChatAdapterRequest['messages'],
): ChatAdapterRequest {
  return {
    requestId: '00000000-0000-4000-8000-0000000000c0',
    modelAlias: harness.modelAlias,
    resolvedModel: harness.resolvedModel,
    messages,
    tools: [WEB_FETCH_TOOL],
    toolChoice: 'auto',
    signal,
  }
}

async function collect(
  adapter: ChatAdapter,
  request: ChatAdapterRequest,
): Promise<ChatAdapterEvent[]> {
  const events: ChatAdapterEvent[] = []
  for await (const event of adapter.stream(request)) events.push(event)
  return events
}

export function describeAgentToolCallingContract(harness: AgentToolCallingContractHarness): void {
  describe(`${harness.name} agent tool-calling contract`, () => {
    it('requests web_fetch on the first turn and finishes with tool_calls', async () => {
      const adapter = harness.createAdapter()
      const events = await collect(
        adapter,
        baseRequest(harness, new AbortController().signal, [
          { role: 'user', content: '帮我看看 https://example.com/ 的内容' },
        ]),
      )

      expect(adapter.id).toBe(harness.adapterId)
      const toolCall = events.find((event) => event.type === 'tool-call')
      expect(toolCall).toMatchObject({
        type: 'tool-call',
        toolCall: { name: 'web_fetch', arguments: { url: 'https://example.com/' } },
      })
      expect(events.at(-1)).toMatchObject({ type: 'finish', finishReason: 'tool_calls' })
      expect(events.some((event) => event.type === 'usage')).toBe(true)
    })

    it('produces a final text answer once a tool result is present', async () => {
      const adapter = harness.createAdapter()
      const events = await collect(
        adapter,
        baseRequest(harness, new AbortController().signal, [
          { role: 'user', content: '帮我看看 https://example.com/ 的内容' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'call_1', name: 'web_fetch', arguments: { url: 'https://example.com/' } },
            ],
          },
          {
            role: 'tool',
            toolCallId: 'call_1',
            toolName: 'web_fetch',
            content: 'Example Domain 示例正文内容。',
          },
        ]),
      )

      expect(events.some((event) => event.type === 'delta')).toBe(true)
      expect(events.at(-1)).toMatchObject({ type: 'finish', finishReason: 'stop' })
      expect(events.some((event) => event.type === 'tool-call')).toBe(false)
    })

    it('propagates cancellation as AbortError', async () => {
      const adapter = harness.createAdapter()
      const controller = new AbortController()
      const request = baseRequest(harness, controller.signal, [
        { role: 'user', content: '帮我看看 https://example.com/ 的内容' },
      ])
      const next = adapter.stream(request)[Symbol.asyncIterator]().next()
      controller.abort()
      await expect(next).rejects.toMatchObject({ name: 'AbortError' })
    })
  })
}
