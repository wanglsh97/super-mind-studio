import { toOpenAICompatibleMessages } from './openai-compatible-message'

describe('toOpenAICompatibleMessages', () => {
  it('preserves native reasoning and tool call/result history', () => {
    expect(
      toOpenAICompatibleMessages([
        {
          role: 'assistant',
          content: '',
          reasoningContent: '需要查询',
          toolCalls: [{ id: 'c1', name: 'web_fetch', arguments: { url: 'https://example.com' } }],
        },
        { role: 'tool', content: 'result', toolCallId: 'c1', toolName: 'web_fetch' },
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: '',
        reasoning_content: '需要查询',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'web_fetch', arguments: '{"url":"https://example.com"}' },
          },
        ],
      },
      { role: 'tool', content: 'result', tool_call_id: 'c1', name: 'web_fetch' },
    ])
  })

  it('omits historical reasoning when the selected mode disables thinking', () => {
    expect(
      toOpenAICompatibleMessages(
        [{ role: 'assistant', content: 'answer', reasoningContent: 'private reasoning' }],
        { includeReasoningContent: false },
      ),
    ).toEqual([{ role: 'assistant', content: 'answer' }])
  })
})
