import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { AgentMessage, AgentStreamEvent } from '@supermind/sdk'

import {
  foldEventsFromCursor,
  isResumableActiveRun,
  mergeThreadMessagesWithRunView,
} from './agent-run-resume'

const runId = 'run-1'

const events: AgentStreamEvent[] = [
  { type: 'run-status', sequence: 0, runId, status: 'running' },
  { type: 'message-start', sequence: 1, runId, messageId: 'm1', role: 'assistant' },
  { type: 'text-delta', sequence: 2, runId, messageId: 'm1', delta: '你好' },
  {
    type: 'tool-call',
    sequence: 3,
    runId,
    messageId: 'm1',
    toolCallId: 't1',
    toolName: 'web_fetch',
    args: { url: 'https://a.test' },
  },
  {
    type: 'tool-result',
    sequence: 4,
    runId,
    toolCallId: 't1',
    toolName: 'web_fetch',
    status: 'succeeded',
    isError: false,
    summary: 'ok',
  },
  { type: 'run-terminal', sequence: 5, runId, status: 'succeeded', limitReason: null },
]

describe('agent run resume helpers', () => {
  it('skips events at or before the cursor so reconnect does not duplicate tools', () => {
    const full = foldEventsFromCursor(events, -1)
    const resumed = foldEventsFromCursor(events, 3)
    assert.equal(full.messages.filter((message) => message.role === 'tool').length, 1)
    // 从 sequence 3 之后开始：跳过已见的 tool-call，只吃 tool-result → 单独 tool 消息
    assert.equal(
      resumed.messages.some((message) => message.role === 'tool'),
      true,
    )
    const fromMid = foldEventsFromCursor(events, 4)
    assert.equal(fromMid.messages.length, 0)
    assert.equal(fromMid.status, 'succeeded')
  })

  it('merges history user messages with resumed assistant/tool turns without duplicating trailing assistant', () => {
    const history: AgentMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: '任务' }],
        createdAt: '2026-07-20T00:00:00.000Z',
      },
      {
        id: 'stale-a',
        role: 'assistant',
        parts: [{ type: 'text', text: '旧快照' }],
        createdAt: '2026-07-20T00:00:01.000Z',
      },
    ]
    const view = foldEventsFromCursor(events, -1)
    const merged = mergeThreadMessagesWithRunView(history, view)
    assert.equal(merged[0]?.role, 'user')
    assert.equal(
      merged.some((message) => message.id === 'stale-a'),
      false,
    )
    assert.ok(merged.some((message) => message.role === 'assistant'))
  })

  it('detects resumable active runs', () => {
    assert.equal(
      isResumableActiveRun({
        id: 'r',
        threadId: 't',
        status: 'running',
        limitReason: null,
        usage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          usageUnknown: true,
          estimatedCostCny: null,
          modelCalls: 0,
          toolCalls: 0,
          webFetchCalls: 0,
        },
        lastSequence: 1,
        createdAt: '',
        startedAt: null,
        completedAt: null,
      }),
      true,
    )
    assert.equal(isResumableActiveRun(null), false)
  })
})
