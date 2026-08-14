import type { AgentMessage } from '../../generated/prisma/client'
import type { AgentMessageWithRunProvider } from '../agent-message.repository'
import {
  assembleAgentHistory,
  persistedMessageToAdapter,
  selectMessagesForForcedSummary,
  selectRecentCompleteTurns,
} from './agent-history-context'

function row(
  overrides: Partial<AgentMessageWithRunProvider> & Pick<AgentMessage, 'role' | 'sequence'>,
): AgentMessageWithRunProvider {
  return {
    id: `m${overrides.sequence}`,
    threadId: 'thread-1',
    runId: 'old-run',
    run: { provider: 'qwen' },
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
        currentProvider: 'qwen',
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

  it.each([
    ['qwen', 'glm'],
    ['glm', 'deepseek'],
  ])(
    'omits %s reasoning when continuing with %s while preserving text and tool linkage',
    (previousProvider, currentProvider) => {
      const messages = [
        row({
          role: 'ASSISTANT',
          sequence: 0,
          run: { provider: previousProvider },
          parts: [
            { type: 'reasoning', text: '厂商私有推理' },
            { type: 'provider-private', payload: '不得回灌' } as never,
            { type: 'text', text: '可移植结论' },
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'web_fetch',
              args: { url: 'https://example.test' },
            },
          ],
        }),
        row({
          role: 'TOOL',
          sequence: 1,
          run: { provider: previousProvider },
          parts: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'web_fetch',
              status: 'succeeded',
              isError: false,
              summary: '工具结果',
            },
          ],
        }),
      ]

      expect(
        assembleAgentHistory({
          persistedMessages: messages,
          currentRunId: 'current-run',
          currentProvider,
          currentMessages: [{ role: 'system', content: 'system' }],
        }),
      ).toEqual([
        { role: 'system', content: 'system' },
        {
          role: 'assistant',
          content: '可移植结论',
          toolCalls: [
            {
              id: 'call-1',
              name: 'web_fetch',
              arguments: { url: 'https://example.test' },
            },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'call-1',
          toolName: 'web_fetch',
          content: JSON.stringify({
            trust: 'untrusted-tool-output',
            status: 'succeeded',
            isError: false,
            summary: '工具结果',
          }),
        },
      ])
    },
  )

  it('retains native reasoning when switching models within the same Provider', () => {
    expect(
      assembleAgentHistory({
        persistedMessages: [
          row({
            role: 'ASSISTANT',
            sequence: 0,
            run: { provider: 'qwen' },
            parts: [
              { type: 'reasoning', text: '可复用推理' },
              { type: 'text', text: '结论' },
            ],
          }),
        ],
        currentRunId: 'current-run',
        currentProvider: 'qwen',
        currentMessages: [],
      }),
    ).toEqual([{ role: 'assistant', content: '结论', reasoningContent: '可复用推理' }])
  })

  it('keeps the existing structured summary when the current Provider changes', () => {
    const summary = {
      userGoals: ['完成当前任务'],
      userConstraints: [],
      decisions: [],
      facts: [],
      openQuestions: [],
      pendingTasks: [],
      toolFindings: [],
      referencedArtifacts: [],
      recentOutcome: '上一阶段完成',
      compressionNotes: [],
    }
    expect(
      assembleAgentHistory({
        persistedMessages: [],
        currentRunId: 'current-run',
        currentProvider: 'deepseek',
        currentMessages: [{ role: 'user', content: '继续' }],
        summary: { content: summary, coveredThroughSequence: 10 },
      }),
    ).toEqual([
      {
        role: 'user',
        content: `<conversation_summary trust="historical-unverified">${JSON.stringify(summary)}</conversation_summary>`,
      },
      { role: 'user', content: '继续' },
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
