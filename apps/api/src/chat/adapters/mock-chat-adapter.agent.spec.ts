import type { ChatAdapterEvent, ChatAdapterMessage, ChatAdapterRequest } from './chat-adapter'
import { MockChatAdapter } from './mock-chat-adapter'
import { describeAgentToolCallingContract } from './testing/agent-tool-calling.contract'

const WEB_FETCH_TOOL = {
  name: 'web_fetch',
  description: 'fetch',
  parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
}

function agentRequest(messages: ChatAdapterMessage[]): ChatAdapterRequest {
  return {
    requestId: '00000000-0000-4000-8000-0000000000a1',
    modelAlias: 'qwen',
    resolvedModel: 'mock-chat-v1',
    messages,
    tools: [WEB_FETCH_TOOL],
    toolChoice: 'auto',
    signal: new AbortController().signal,
  }
}

async function collect(
  adapter: MockChatAdapter,
  request: ChatAdapterRequest,
): Promise<ChatAdapterEvent[]> {
  const events: ChatAdapterEvent[] = []
  for await (const event of adapter.stream(request)) events.push(event)
  return events
}

describeAgentToolCallingContract({
  name: 'Mock',
  adapterId: 'mock',
  modelAlias: 'qwen',
  resolvedModel: 'mock-chat-v1',
  createAdapter: () => new MockChatAdapter({ chunks: ['unused'], delayMs: 5 }),
})

describe('MockChatAdapter agent mode', () => {
  it('suppresses reasoning events in fast mode while preserving tool calls', async () => {
    const adapter = new MockChatAdapter({ chunks: ['unused'], delayMs: 0 })
    const events = await collect(adapter, {
      ...agentRequest([{ role: 'user', content: '请阅读 https://news.test/article' }]),
      thinkingEffort: 'fast',
    })

    expect(events.some((event) => event.type === 'reasoning')).toBe(false)
    expect(events.some((event) => event.type === 'tool-call')).toBe(true)
  })

  it('emits reasoning then a web_fetch tool call on the first turn', async () => {
    const adapter = new MockChatAdapter({ chunks: ['unused'], delayMs: 0 })
    const events = await collect(
      adapter,
      agentRequest([{ role: 'user', content: '请阅读 https://news.test/article' }]),
    )

    expect(events[0]).toMatchObject({ type: 'reasoning' })
    expect(events[1]).toMatchObject({
      type: 'tool-call',
      toolCall: {
        id: 'call_1',
        name: 'web_fetch',
        arguments: { url: 'https://news.test/article' },
      },
    })
    expect(events.at(-1)).toMatchObject({ type: 'finish', finishReason: 'tool_calls' })
  })

  it('answers with final text after a tool result is provided', async () => {
    const adapter = new MockChatAdapter({ chunks: ['unused'], delayMs: 0 })
    const events = await collect(
      adapter,
      agentRequest([
        { role: 'user', content: '请阅读 https://news.test/article' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call_1', name: 'web_fetch', arguments: { url: 'https://news.test/article' } },
          ],
        },
        { role: 'tool', toolCallId: 'call_1', toolName: 'web_fetch', content: '正文：今日要闻。' },
      ]),
    )

    const deltas = events.filter((event) => event.type === 'delta')
    expect(deltas.length).toBeGreaterThan(0)
    expect(deltas.map((event) => (event as { content: string }).content).join('')).toContain(
      '正文：今日要闻。',
    )
    expect(events.some((event) => event.type === 'tool-call')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'finish', finishReason: 'stop' })
  })

  it('requests multiple fetches deterministically when FETCH:2 is set', async () => {
    const adapter = new MockChatAdapter({ chunks: ['unused'], delayMs: 0 })

    const firstTurn = await collect(
      adapter,
      agentRequest([{ role: 'user', content: 'FETCH:2 请对比 https://a.test 与 https://b.test' }]),
    )
    expect(firstTurn.find((event) => event.type === 'tool-call')).toMatchObject({
      toolCall: { id: 'call_1', name: 'web_fetch' },
    })
    expect(firstTurn.at(-1)).toMatchObject({ finishReason: 'tool_calls' })

    const secondTurn = await collect(
      adapter,
      agentRequest([
        { role: 'user', content: 'FETCH:2 请对比 https://a.test 与 https://b.test' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'web_fetch', arguments: { url: 'https://a.test' } }],
        },
        { role: 'tool', toolCallId: 'call_1', toolName: 'web_fetch', content: 'A 内容' },
      ]),
    )
    expect(secondTurn.find((event) => event.type === 'tool-call')).toMatchObject({
      toolCall: { id: 'call_2', name: 'web_fetch' },
    })
    expect(secondTurn.at(-1)).toMatchObject({ finishReason: 'tool_calls' })
  })

  it('supports unknown-tool and invalid-args scenarios for tool registry tests', async () => {
    const adapter = new MockChatAdapter({ chunks: ['unused'], delayMs: 0 })

    const unknown = await collect(
      adapter,
      agentRequest([{ role: 'user', content: 'SCENARIO:unknown-tool 触发未知工具' }]),
    )
    expect(unknown.find((event) => event.type === 'tool-call')).toMatchObject({
      toolCall: { name: 'nonexistent_tool' },
    })

    const invalid = await collect(
      adapter,
      agentRequest([{ role: 'user', content: 'SCENARIO:invalid-args 触发无效参数' }]),
    )
    expect(invalid.find((event) => event.type === 'tool-call')).toMatchObject({
      toolCall: { name: 'web_fetch', arguments: {} },
    })
  })

  it('requests the deterministic Skill Shell command and follows up after its result', async () => {
    const adapter = new MockChatAdapter({ chunks: ['unused'], delayMs: 0 })
    const first = await collect(
      adapter,
      agentRequest([{ role: 'user', content: 'SCENARIO:shell 清洗数据' }]),
    )
    expect(first.find((event) => event.type === 'tool-call')).toMatchObject({
      toolCall: {
        id: 'call_1',
        name: 'shell',
        arguments: {
          command: 'node scripts/clean.mjs',
          workingDirectory: '/workspace/skills/mock-data-cleaner',
        },
      },
    })

    const followUp = await collect(
      adapter,
      agentRequest([
        { role: 'user', content: 'SCENARIO:shell 清洗数据' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'shell',
              arguments: { command: 'node scripts/clean.mjs' },
            },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'call_1',
          toolName: 'shell',
          content: 'Mock Skill completed',
        },
      ]),
    )
    expect(followUp.some((event) => event.type === 'tool-call')).toBe(false)
    expect(
      followUp
        .filter((event) => event.type === 'delta')
        .map((event) => (event as { content: string }).content)
        .join(''),
    ).toContain('Mock Skill completed')
  })

  it('emits a normalized model stream error for the stream-error scenario', async () => {
    const adapter = new MockChatAdapter({ chunks: ['unused'], delayMs: 0 })
    await expect(
      collect(adapter, agentRequest([{ role: 'user', content: 'SCENARIO:stream-error' }])),
    ).rejects.toMatchObject({
      name: 'ChatAdapterError',
      code: 'MOCK_AGENT_STREAM_ERROR',
      retryable: false,
    })
  })

  it('propagates cancellation during an agent turn', async () => {
    const adapter = new MockChatAdapter({ chunks: ['unused'], delayMs: 1_000 })
    const controller = new AbortController()
    const request = {
      ...agentRequest([{ role: 'user', content: '读取 https://slow.test' }]),
      signal: controller.signal,
    }
    const iterator = adapter.stream(request)[Symbol.asyncIterator]()
    const next = iterator.next()
    controller.abort()
    await expect(next).rejects.toMatchObject({ name: 'AbortError' })
  })
})
