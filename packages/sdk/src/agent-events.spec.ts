import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { decodeAgentEvent, encodeAgentEvent } from './agent-events.js'
import type { AgentStreamEvent } from './agent-types.js'
import { AIGatewayProtocolError } from './errors.js'

const runId = '00000000-0000-4000-8000-00000000abcd'
const packageSha256 = 'a'.repeat(64)
const outputSha256 = 'b'.repeat(64)

const events: AgentStreamEvent[] = [
  { type: 'run-status', sequence: 0, runId, status: 'running' },
  { type: 'message-start', sequence: 1, runId, messageId: 'm1', role: 'assistant' },
  { type: 'reasoning-delta', sequence: 2, runId, messageId: 'm1', delta: '思考中' },
  {
    type: 'user-question-asked',
    sequence: 3,
    runId,
    question: {
      id: 'question-1',
      runId,
      status: 'pending',
      questions: [
        {
          id: 'item-1',
          header: '认证方式',
          question: '请选择认证方式',
          multiSelect: false,
          options: [
            { id: 'option-1', label: 'OAuth', description: '第三方授权' },
            { id: 'option-2', label: 'Password', description: '账号密码' },
          ],
        },
      ],
      createdAt: '2026-08-04T00:00:00.000Z',
      settledAt: null,
    },
  },
  {
    type: 'user-question-answered',
    sequence: 4,
    runId,
    questionId: 'question-1',
    answers: [{ questionId: 'item-1', selectedOptionIds: ['option-1'] }],
  },
  { type: 'user-question-skipped', sequence: 5, runId, questionId: 'question-2' },
  {
    type: 'context-budget',
    sequence: 6,
    runId,
    usedTokens: 60,
    usableTokens: 100,
    contextWindowTokens: 128,
    estimated: true,
    level: 'light',
  },
  {
    type: 'context-compressed',
    sequence: 7,
    runId,
    level: 'forced',
    notes: ['structured-summary-updated'],
    summaryId: 'summary-1',
    revision: 2,
    coveredThroughSequence: 12,
  },
  { type: 'text-delta', sequence: 8, runId, messageId: 'm1', delta: '正在处理' },
  {
    type: 'tool-call',
    sequence: 9,
    runId,
    messageId: 'm1',
    toolCallId: 't1',
    toolName: 'web_fetch',
    args: { url: 'https://example.com' },
  },
  {
    type: 'tool-status',
    sequence: 10,
    runId,
    toolCallId: 't1',
    toolName: 'web_fetch',
    status: 'running',
  },
  {
    type: 'tool-result',
    sequence: 11,
    runId,
    toolCallId: 't1',
    toolName: 'web_fetch',
    status: 'succeeded',
    isError: false,
    summary: '已抓取 example.com',
    audit: { finalUrl: 'https://example.com/', status: 200, bytes: 1234 },
  },
  {
    type: 'skill-activation',
    sequence: 12,
    runId,
    status: 'succeeded',
    source: 'manual',
    skillId: 'skill-1',
    skillName: 'data-cleaner',
    packageSha256,
  },
  {
    type: 'shell-execution',
    sequence: 13,
    runId,
    toolCallId: 't2',
    status: 'succeeded',
    sandboxId: 'sandbox-1',
    command: 'node scripts/clean.mjs',
    workingDirectory: '/workspace/.skills/data-cleaner',
    exitCode: 0,
    durationMs: 321,
    stdout: { bytes: 8, truncated: false, content: '完成\n' },
    stderr: { bytes: 0, truncated: false, content: '' },
    limitReason: null,
  },
  {
    type: 'file-operation',
    sequence: 14,
    runId,
    toolCallId: 't3',
    status: 'succeeded',
    operation: 'export-output',
    direction: 'output',
    fileId: 'file-1',
    path: '/workspace/output/result.csv',
    size: 42,
    sha256: outputSha256,
  },
  { type: 'message-end', sequence: 15, runId, messageId: 'm1' },
  {
    type: 'usage',
    sequence: 16,
    runId,
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      estimatedCostCny: '0.00120000',
      usageUnknown: false,
      modelCalls: 2,
      toolCalls: 1,
      webFetchCalls: 1,
    },
  },
  {
    type: 'run-terminal',
    sequence: 17,
    runId,
    status: 'succeeded',
    limitReason: null,
  },
  { type: 'sandbox-status', sequence: 18, runId, status: 'creating' },
  {
    type: 'sandbox-status',
    sequence: 19,
    runId,
    status: 'ready',
    sandboxId: 'sandbox-1',
  },
]

describe('agent event wire codec', () => {
  it('round-trips every event type through encode/decode with matching runId', () => {
    for (const event of events) {
      const wire = encodeAgentEvent(event)
      assert.equal(wire.runId, runId)
      assert.equal(wire.type, event.type)
      const decoded = decodeAgentEvent(JSON.parse(JSON.stringify(wire)), runId)
      assert.deepEqual(decoded, event)
    }
  })

  it('decodes a terminal limit_reached event with an explicit reason', () => {
    const decoded = decodeAgentEvent(
      encodeAgentEvent({
        type: 'run-terminal',
        sequence: 12,
        runId,
        status: 'limit_reached',
        limitReason: 'sandbox_resource',
      }),
      runId,
    )
    assert.deepEqual(decoded, {
      type: 'run-terminal',
      sequence: 12,
      runId,
      status: 'limit_reached',
      limitReason: 'sandbox_resource',
    })
  })

  it('decodes an error event and preserves the gateway error envelope', () => {
    const decoded = decodeAgentEvent(
      {
        type: 'error',
        sequence: 3,
        runId,
        error: { requestId: 'r1', code: 'AGENT_STREAM_ERROR', message: '失败', retryable: true },
      },
      runId,
    )
    assert.deepEqual(decoded, {
      type: 'error',
      sequence: 3,
      runId,
      error: { requestId: 'r1', code: 'AGENT_STREAM_ERROR', message: '失败', retryable: true },
    })
  })

  it('preserves normalized execution errors on failed sandbox events', () => {
    const event: AgentStreamEvent = {
      type: 'shell-execution',
      sequence: 15,
      runId,
      toolCallId: 't4',
      status: 'failed',
      sandboxId: 'sandbox-1',
      command: 'sleep 90',
      workingDirectory: '/workspace',
      exitCode: null,
      durationMs: 60_000,
      limitReason: 'command_timeout',
      error: {
        code: 'SHELL_COMMAND_TIMEOUT',
        message: '命令执行超过 60 秒',
        retryable: false,
        details: { timeoutMs: 60_000 },
      },
    }
    assert.deepEqual(decodeAgentEvent(encodeAgentEvent(event), runId), event)
  })

  it('rejects a runId that does not match the subscribed run', () => {
    assert.throws(
      () =>
        decodeAgentEvent(
          { type: 'run-status', sequence: 0, runId: 'other', status: 'running' },
          runId,
        ),
      AIGatewayProtocolError,
    )
  })

  it('rejects negative or non-integer sequences', () => {
    assert.throws(
      () => decodeAgentEvent({ type: 'run-status', sequence: -1, runId, status: 'running' }),
      AIGatewayProtocolError,
    )
    assert.throws(
      () => decodeAgentEvent({ type: 'run-status', sequence: 1.5, runId, status: 'running' }),
      AIGatewayProtocolError,
    )
  })

  it('rejects unknown event types and invalid enums', () => {
    assert.throws(
      () => decodeAgentEvent({ type: 'nope', sequence: 0, runId }),
      AIGatewayProtocolError,
    )
    assert.throws(
      () => decodeAgentEvent({ type: 'run-status', sequence: 0, runId, status: 'weird' }),
      AIGatewayProtocolError,
    )
    assert.throws(
      () =>
        decodeAgentEvent({
          type: 'skill-activation',
          sequence: 0,
          runId,
          status: 'succeeded',
          source: 'manual',
          skillId: 'skill-1',
          skillName: 'data-cleaner',
          packageSha256: 'not-a-sha',
        }),
      AIGatewayProtocolError,
    )
  })
})
