import { ChatAdapterError } from './chat-adapter'
import {
  OpenAICompatibleToolCallAssembler,
  openAICompatibleToolRequestFields,
} from './openai-compatible-tool-calling'

const protocolError = (message: string, cause?: unknown) =>
  new ChatAdapterError(message, {
    code: 'TEST_PROTOCOL_ERROR',
    retryable: true,
    ...(cause === undefined ? {} : { cause }),
  })

describe('openAICompatibleToolRequestFields', () => {
  it('omits tool fields when no tools are available', () => {
    expect(openAICompatibleToolRequestFields({})).toEqual({})
  })

  it('maps platform tools and defaults tool_choice to auto', () => {
    expect(
      openAICompatibleToolRequestFields({
        tools: [
          {
            name: 'web_fetch',
            description: 'Fetch a public URL.',
            parameters: { type: 'object', required: ['url'] },
          },
        ],
      }),
    ).toEqual({
      tools: [
        {
          type: 'function',
          function: {
            name: 'web_fetch',
            description: 'Fetch a public URL.',
            parameters: { type: 'object', required: ['url'] },
          },
        },
      ],
      tool_choice: 'auto',
    })
  })
})

describe('OpenAICompatibleToolCallAssembler', () => {
  it('assembles multiple fragmented tool calls in index order', () => {
    const assembler = new OpenAICompatibleToolCallAssembler('Test', protocolError)
    assembler.addDeltas([
      {
        index: 1,
        id: 'call_2',
        function: { name: 'web_fetch', arguments: '{"url":"https://b.' },
      },
      {
        index: 0,
        id: 'call_1',
        function: { name: 'web_fetch', arguments: '{"url":"https://a.' },
      },
    ])
    assembler.addDeltas([
      { index: 0, function: { arguments: 'test/"}' } },
      { index: 1, function: { arguments: 'test/"}' } },
    ])

    expect(assembler.finish('tool_calls')).toEqual([
      { id: 'call_1', name: 'web_fetch', arguments: { url: 'https://a.test/' } },
      { id: 'call_2', name: 'web_fetch', arguments: { url: 'https://b.test/' } },
    ])
    expect(() => assembler.assertStreamDone('tool_calls')).not.toThrow()
  })

  it('rejects invalid JSON arguments with the provider protocol error', () => {
    const assembler = new OpenAICompatibleToolCallAssembler('Test', protocolError)
    assembler.addDeltas([
      {
        index: 0,
        id: 'call_1',
        function: { name: 'web_fetch', arguments: '{not-json' },
      },
    ])

    expect(() => assembler.finish('tool_calls')).toThrow(
      expect.objectContaining({ code: 'TEST_PROTOCOL_ERROR' }),
    )
  })

  it('rejects tool-call fragments paired with a non-tool finish reason', () => {
    const assembler = new OpenAICompatibleToolCallAssembler('Test', protocolError)
    assembler.addDeltas([
      {
        index: 0,
        id: 'call_1',
        function: { name: 'web_fetch', arguments: '{}' },
      },
    ])

    expect(() => assembler.finish('stop')).toThrow(
      'Test emitted tool-call fragments but finished with stop',
    )
  })

  it('rejects tool_calls finish without fragments', () => {
    const assembler = new OpenAICompatibleToolCallAssembler('Test', protocolError)
    expect(() => assembler.finish('tool_calls')).toThrow(
      'Test finished with tool_calls but supplied no tool-call fragments',
    )
  })
})
