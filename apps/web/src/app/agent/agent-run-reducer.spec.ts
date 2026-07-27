import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { AgentStreamEvent } from '@supermind/sdk'

import { initialAgentRunViewState, isActiveStatus, reduceAgentEvents } from './agent-run-reducer.js'

const runId = 'run-1'

const events: AgentStreamEvent[] = [
  { type: 'run-status', sequence: 0, runId, status: 'running' },
  { type: 'message-start', sequence: 1, runId, messageId: 'm1', role: 'assistant' },
  { type: 'reasoning-delta', sequence: 2, runId, messageId: 'm1', delta: '先' },
  { type: 'reasoning-delta', sequence: 3, runId, messageId: 'm1', delta: '思考' },
  {
    type: 'tool-call',
    sequence: 4,
    runId,
    messageId: 'm1',
    toolCallId: 't1',
    toolName: 'web_fetch',
    args: { url: 'https://a.test' },
  },
  {
    type: 'tool-status',
    sequence: 5,
    runId,
    toolCallId: 't1',
    toolName: 'web_fetch',
    status: 'running',
  },
  {
    type: 'tool-result',
    sequence: 6,
    runId,
    toolCallId: 't1',
    toolName: 'web_fetch',
    status: 'succeeded',
    isError: false,
    summary: '已抓取 a.test',
    audit: { finalUrl: 'https://a.test/', status: 200 },
  },
  { type: 'message-end', sequence: 7, runId, messageId: 'm1' },
  { type: 'message-start', sequence: 8, runId, messageId: 'm2', role: 'assistant' },
  { type: 'text-delta', sequence: 9, runId, messageId: 'm2', delta: '答' },
  { type: 'text-delta', sequence: 10, runId, messageId: 'm2', delta: '案' },
  { type: 'message-end', sequence: 11, runId, messageId: 'm2' },
  {
    type: 'usage',
    sequence: 12,
    runId,
    usage: {
      inputTokens: 5,
      outputTokens: 7,
      totalTokens: 12,
      estimatedCostCny: null,
      usageUnknown: false,
      modelCalls: 2,
      toolCalls: 1,
      webFetchCalls: 1,
    },
  },
  { type: 'run-terminal', sequence: 13, runId, status: 'succeeded', limitReason: null },
]

describe('reduceAgentEvents', () => {
  it('folds a full tool loop into rendered messages matching persisted shape', () => {
    const state = reduceAgentEvents(initialAgentRunViewState(), events)

    assert.equal(state.status, 'succeeded')
    assert.equal(state.usage?.modelCalls, 2)
    assert.equal(state.messages.length, 3)

    assert.deepEqual(state.messages[0], {
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: '先思考' },
        {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'web_fetch',
          args: { url: 'https://a.test' },
        },
      ],
      createdAt: '',
    })
    assert.deepEqual(state.messages[1], {
      id: 't1',
      role: 'tool',
      parts: [
        {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'web_fetch',
          status: 'succeeded',
          isError: false,
          summary: '已抓取 a.test',
          audit: { finalUrl: 'https://a.test/', status: 200 },
        },
      ],
      createdAt: '',
    })
    assert.deepEqual(state.messages[2]?.parts, [{ type: 'text', text: '答案' }])
  })

  it('reports error and limit reason terminal states', () => {
    const errored = reduceAgentEvents(initialAgentRunViewState(), [
      { type: 'run-status', sequence: 0, runId, status: 'running' },
      {
        type: 'error',
        sequence: 1,
        runId,
        error: { requestId: 'r', code: 'AGENT_RUN_FAILED', message: '失败', retryable: true },
      },
      { type: 'run-terminal', sequence: 2, runId, status: 'failed', limitReason: null },
    ])
    assert.equal(errored.status, 'failed')
    assert.equal(errored.error?.code, 'AGENT_RUN_FAILED')

    const limited = reduceAgentEvents(initialAgentRunViewState(), [
      {
        type: 'run-terminal',
        sequence: 0,
        runId,
        status: 'limit_reached',
        limitReason: 'web_fetch_calls',
      },
    ])
    assert.equal(limited.status, 'limit_reached')
    assert.equal(limited.limitReason, 'web_fetch_calls')
  })

  it('restores context budget and compression timeline from replayed events', () => {
    const state = reduceAgentEvents(initialAgentRunViewState(), [
      {
        type: 'context-budget',
        sequence: 0,
        runId,
        usedTokens: 75,
        usableTokens: 100,
        contextWindowTokens: 128,
        estimated: true,
        level: 'moderate',
      },
      {
        type: 'context-compressed',
        sequence: 1,
        runId,
        level: 'moderate',
        notes: ['removed-completed-reasoning'],
      },
    ])
    assert.equal(state.contextBudget?.usedTokens, 75)
    assert.equal(state.compressionEvents[0]?.level, 'moderate')
  })

  it('classifies active statuses', () => {
    assert.equal(isActiveStatus('running'), true)
    assert.equal(isActiveStatus('cancelling'), true)
    assert.equal(isActiveStatus('succeeded'), false)
    assert.equal(isActiveStatus('idle'), false)
  })
})
