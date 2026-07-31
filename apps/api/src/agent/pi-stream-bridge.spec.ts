import type { Context } from '@earendil-works/pi-ai'

import type { ModelStreamEvent } from '../chat/model-invocation.port'
import { ChatAdapterError } from '../chat/adapters/chat-adapter'
import {
  mapModelStreamToPiEvents,
  piContextToInvocationMessages,
  piToolsToDefinitions,
} from './pi-stream-bridge'

const meta = { api: 'openai-completions' as const, provider: 'mock', model: 'mock-chat-v1' }

async function* fromArray(events: ModelStreamEvent[]): AsyncGenerator<ModelStreamEvent> {
  for (const event of events) yield event
}

async function* fromArrayThenThrow(
  events: ModelStreamEvent[],
  error: Error,
): AsyncGenerator<ModelStreamEvent> {
  for (const event of events) yield event
  throw error
}

async function collect(source: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const event of source) out.push(event)
  return out
}

const now = () => 1_700_000_000_000

describe('piContextToInvocationMessages', () => {
  it('maps system prompt, user, assistant tool calls and tool results', () => {
    const context: Context = {
      systemPrompt: '你是通用助手',
      messages: [
        { role: 'user', content: '看看 https://a.test', timestamp: 1 },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '好的' },
            { type: 'thinking', thinking: '先检查来源' },
            {
              type: 'toolCall',
              id: 'call_1',
              name: 'web_fetch',
              arguments: { url: 'https://a.test' },
            },
          ],
          api: 'openai-completions',
          provider: 'mock',
          model: 'm',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse',
          timestamp: 2,
        },
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'web_fetch',
          content: [{ type: 'text', text: '网页正文' }],
          isError: false,
          timestamp: 3,
        },
      ],
    }

    expect(piContextToInvocationMessages(context)).toEqual([
      { role: 'system', content: '你是通用助手' },
      { role: 'user', content: '看看 https://a.test' },
      {
        role: 'assistant',
        content: '好的',
        reasoningContent: '先检查来源',
        toolCalls: [{ id: 'call_1', name: 'web_fetch', arguments: { url: 'https://a.test' } }],
      },
      { role: 'tool', toolCallId: 'call_1', toolName: 'web_fetch', content: '网页正文' },
    ])
  })
})

describe('piToolsToDefinitions', () => {
  it('maps Pi tools to provider-neutral JSON Schema definitions', () => {
    expect(
      piToolsToDefinitions([
        { name: 'web_fetch', description: 'fetch', parameters: { type: 'object' } as never },
      ]),
    ).toEqual([{ name: 'web_fetch', description: 'fetch', parameters: { type: 'object' } }])
    expect(piToolsToDefinitions(undefined)).toEqual([])
  })
})

describe('mapModelStreamToPiEvents', () => {
  it('maps reasoning then text then finish into ordered Pi events', async () => {
    const events = await collect(
      mapModelStreamToPiEvents(
        fromArray([
          { type: 'reasoning', delta: '先思考' },
          { type: 'text', delta: '答' },
          { type: 'text', delta: '案' },
          {
            type: 'usage',
            usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, usageUnknown: false },
          },
          { type: 'finish', finishReason: 'stop', provider: 'qwen', resolvedModel: 'mock-chat-v1' },
        ]),
        meta,
        undefined,
        now,
      ),
    )

    const types = events.map((event) => (event as { type: string }).type)
    expect(types).toEqual([
      'start',
      'thinking_start',
      'thinking_delta',
      'thinking_end',
      'text_start',
      'text_delta',
      'text_delta',
      'text_end',
      'done',
    ])
    const done = events.at(-1) as {
      type: 'done'
      reason: string
      message: { content: unknown[]; usage: { totalTokens: number }; stopReason: string }
    }
    expect(done.reason).toBe('stop')
    expect(done.message.stopReason).toBe('stop')
    expect(done.message.usage.totalTokens).toBe(5)
    expect(done.message.content).toEqual([
      { type: 'thinking', thinking: '先思考' },
      { type: 'text', text: '答案' },
    ])
  })

  it('maps a tool call and finishes with toolUse', async () => {
    const events = await collect(
      mapModelStreamToPiEvents(
        fromArray([
          {
            type: 'tool-call',
            toolCall: { id: 'call_1', name: 'web_fetch', arguments: { url: 'https://a.test' } },
          },
          {
            type: 'usage',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, usageUnknown: false },
          },
          {
            type: 'finish',
            finishReason: 'tool_calls',
            provider: 'qwen',
            resolvedModel: 'mock-chat-v1',
          },
        ]),
        meta,
        undefined,
        now,
      ),
    )

    const types = events.map((event) => (event as { type: string }).type)
    expect(types).toEqual(['start', 'toolcall_start', 'toolcall_end', 'done'])
    const toolEnd = events[2] as { type: 'toolcall_end'; toolCall: { name: string } }
    expect(toolEnd.toolCall).toEqual({
      type: 'toolCall',
      id: 'call_1',
      name: 'web_fetch',
      arguments: { url: 'https://a.test' },
    })
    const done = events.at(-1) as { reason: string }
    expect(done.reason).toBe('toolUse')
  })

  it('encodes a thrown model error as an error event without throwing', async () => {
    const events = await collect(
      mapModelStreamToPiEvents(
        fromArrayThenThrow(
          [{ type: 'text', delta: '部分' }],
          new ChatAdapterError('上游失败', { code: 'MOCK', retryable: false }),
        ),
        meta,
        undefined,
        now,
      ),
    )

    const last = events.at(-1) as {
      type: string
      reason: string
      error: { stopReason: string; errorMessage: string }
    }
    expect(last.type).toBe('error')
    expect(last.reason).toBe('error')
    expect(last.error.stopReason).toBe('error')
    expect(last.error.errorMessage).toBe('上游失败')
    // 开启的 text 块在错误前被关闭
    expect(events.map((event) => (event as { type: string }).type)).toContain('text_end')
  })

  it('marks the terminal event as aborted when the signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const events = await collect(
      mapModelStreamToPiEvents(
        fromArrayThenThrow([], new DOMException('aborted', 'AbortError')),
        meta,
        controller.signal,
        now,
      ),
    )
    const last = events.at(-1) as { type: string; reason: string }
    expect(last.type).toBe('error')
    expect(last.reason).toBe('aborted')
  })
})
