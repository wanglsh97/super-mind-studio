import type { AgentMessage } from '../../generated/prisma/client'
import {
  assembleAgentHistory,
  persistedMessageToAdapter,
  selectMessagesForForcedSummary,
  selectRecentCompleteTurns,
} from './agent-history-context'

function row(
  overrides: Partial<AgentMessage> & Pick<AgentMessage, 'role' | 'sequence'>,
): AgentMessage {
  return {
    id: `m${overrides.sequence}`,
    threadId: 'thread-1',
    runId: 'old-run',
    parts: [],
    createdAt: new Date(0),
    ...overrides,
  }
}

describe('agent history context', () => {
  it('prepends persisted history, excludes current run and preserves current Pi context', () => {
    const messages = [
      row({ role: 'USER', sequence: 0, parts: [{ type: 'text', text: '旧问题' }] }),
      row({
        role: 'ASSISTANT',
        sequence: 1,
        parts: [
          { type: 'reasoning', text: '旧推理' },
          { type: 'text', text: '旧回答' },
        ],
      }),
      row({
        role: 'USER',
        sequence: 2,
        runId: 'current-run',
        parts: [{ type: 'text', text: '新问题' }],
      }),
    ]
    expect(
      assembleAgentHistory({
        persistedMessages: messages,
        currentRunId: 'current-run',
        currentMessages: [
          { role: 'system', content: 'system' },
          { role: 'user', content: '新问题' },
          { role: 'tool', toolCallId: 'c1', toolName: 'web_fetch', content: '本轮工具结果' },
        ],
      }),
    ).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回答', reasoningContent: '旧推理' },
      { role: 'user', content: '新问题' },
      { role: 'tool', toolCallId: 'c1', toolName: 'web_fetch', content: '本轮工具结果' },
    ])
  })

  it('uses a low-trust tag when native reasoning input is unavailable', () => {
    expect(
      persistedMessageToAdapter(
        row({
          role: 'ASSISTANT',
          sequence: 0,
          parts: [
            { type: 'reasoning', text: '<猜测>' },
            { type: 'text', text: '结论' },
          ],
        }),
        'tagged',
      ),
    ).toEqual([
      {
        role: 'assistant',
        content:
          '<historical_reasoning trust="unverified">&lt;猜测&gt;</historical_reasoning>\n结论',
      },
    ])
  })

  it('selects the last complete turns without reordering messages', () => {
    const messages = Array.from({ length: 6 }, (_, index) =>
      row({
        role: index % 2 === 0 ? 'USER' : 'ASSISTANT',
        sequence: index,
      }),
    )
    expect(selectRecentCompleteTurns(messages, 2).map((message) => message.sequence)).toEqual([
      2, 3, 4, 5,
    ])
  })

  it('forced summary selection keeps the latest two complete turns', () => {
    const messages = Array.from({ length: 8 }, (_, index) =>
      row({
        role: index % 2 === 0 ? 'USER' : 'ASSISTANT',
        sequence: index,
      }),
    )
    expect(
      selectMessagesForForcedSummary(messages, 'current-run', -1).map(
        (message) => message.sequence,
      ),
    ).toEqual([0, 1, 2, 3])
  })
})
