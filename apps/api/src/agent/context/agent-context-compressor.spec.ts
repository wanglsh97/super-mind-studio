import type { ChatAdapterMessage } from '../../adapters/chat-adapter'
import { compressAgentContext } from './agent-context-compressor'

function conversation(turns: number): ChatAdapterMessage[] {
  return Array.from({ length: turns }, (_, turn) => [
    { role: 'user' as const, content: `q${turn}` },
    { role: 'assistant' as const, content: `a${turn}`, reasoningContent: `r${turn}` },
  ]).flat()
}

describe('compressAgentContext', () => {
  it('light removes only reasoning older than the latest four turns', () => {
    const result = compressAgentContext(conversation(6), 'light')
    expect(
      result.messages
        .filter((message) => message.reasoningContent)
        .map((message) => message.reasoningContent),
    ).toEqual(['r2', 'r3', 'r4', 'r5'])
    expect(result.messages.map((message) => message.content)).toEqual(
      conversation(6).map((message) => message.content),
    )
  })

  it('moderate removes completed reasoning and compacts old tool results', () => {
    const huge = JSON.stringify({
      trust: 'untrusted-tool-output',
      status: 'succeeded',
      isError: false,
      summary: 'x'.repeat(900),
      audit: { secret: 'drop' },
    })
    const input: ChatAdapterMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'old' },
      {
        role: 'assistant',
        content: '',
        reasoningContent: 'old reasoning',
        toolCalls: [{ id: 'c1', name: 'web_fetch', arguments: {} }],
      },
      { role: 'tool', content: huge, toolCallId: 'c1', toolName: 'web_fetch' },
      { role: 'user', content: 'CURRENT-INPUT-MUST-STAY' },
      {
        role: 'assistant',
        content: '',
        reasoningContent: 'current reasoning',
        toolCalls: [{ id: 'c2', name: 'web_fetch', arguments: {} }],
      },
    ]
    const result = compressAgentContext(input, 'moderate')
    expect(result.messages[2]?.reasoningContent).toBeUndefined()
    expect(result.messages[3]?.content.length).toBeLessThanOrEqual(524)
    expect(result.messages[3]?.content).not.toContain('secret')
    expect(result.messages[4]?.content).toBe('CURRENT-INPUT-MUST-STAY')
    expect(result.messages[5]?.reasoningContent).toBe('current reasoning')
    expect(result.messages[5]?.toolCalls?.[0]?.id).toBe('c2')
  })

  it('none returns an equivalent copy without mutation', () => {
    const input = conversation(1)
    const result = compressAgentContext(input, 'none')
    expect(result).toEqual({ messages: input, changed: false, notes: [] })
    expect(result.messages).not.toBe(input)
  })
})
