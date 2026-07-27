import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, AssistantMessageEvent, Usage } from '@earendil-works/pi-ai'

import { AgentRunProjector } from './agent-run.projector'

const runId = '00000000-0000-4000-8000-0000000000e0'

function usage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function assistantMessage(): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'mock',
    model: 'm',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 0,
  }
}

function update(event: AssistantMessageEvent): AgentEvent {
  return { type: 'message_update', message: assistantMessage(), assistantMessageEvent: event }
}

function idFactory(): () => string {
  let n = 0
  return () => `msg_${(n += 1)}`
}

function drive(
  projector: AgentRunProjector,
  events: AgentEvent[],
): ReturnType<AgentRunProjector['ingest']> {
  return events.flatMap((event) => projector.ingest(event))
}

describe('AgentRunProjector', () => {
  it('projects Sandbox creation and readiness as ordered replayable events', () => {
    const projector = new AgentRunProjector('run-sandbox', () => 'message-1')
    const events = [
      ...projector.start(),
      ...projector.sandboxStatus({ status: 'creating' }),
      ...projector.sandboxStatus({ status: 'ready', sandboxId: 'sandbox-1' }),
    ]

    expect(events).toEqual([
      { type: 'run-status', sequence: 0, runId: 'run-sandbox', status: 'running' },
      { type: 'sandbox-status', sequence: 1, runId: 'run-sandbox', status: 'creating' },
      {
        type: 'sandbox-status',
        sequence: 2,
        runId: 'run-sandbox',
        status: 'ready',
        sandboxId: 'sandbox-1',
      },
    ])
  })

  it('projects manual Skill activation into ordered replayable events', () => {
    const projector = new AgentRunProjector('run-skill', () => 'message-1')
    const events = [
      ...projector.start(),
      ...projector.skillActivation({
        status: 'running',
        source: 'manual',
        skillId: 'mock-data-cleaner',
        skillName: 'mock-data-cleaner',
      }),
      ...projector.skillActivation({
        status: 'succeeded',
        source: 'manual',
        skillId: 'skill-1',
        skillName: 'mock-data-cleaner',
        packageSha256: 'a'.repeat(64),
      }),
    ]

    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2])
    expect(events[2]).toMatchObject({
      type: 'skill-activation',
      runId: 'run-skill',
      status: 'succeeded',
      packageSha256: 'a'.repeat(64),
    })
  })

  it('projects a full tool loop into monotonic sequenced events and a message snapshot', () => {
    const projector = new AgentRunProjector(runId, idFactory())
    const events = [
      ...projector.start(),
      ...drive(projector, [
        { type: 'turn_start' },
        { type: 'message_start', message: assistantMessage() },
        update({
          type: 'thinking_delta',
          contentIndex: 0,
          delta: '先思考',
          partial: assistantMessage(),
        }),
        update({
          type: 'toolcall_end',
          contentIndex: 1,
          toolCall: {
            type: 'toolCall',
            id: 'call_1',
            name: 'web_fetch',
            arguments: { url: 'https://a.test' },
          },
          partial: assistantMessage(),
        }),
        { type: 'message_end', message: assistantMessage() },
        {
          type: 'tool_execution_start',
          toolCallId: 'call_1',
          toolName: 'web_fetch',
          args: { url: 'https://a.test' },
        },
        {
          type: 'tool_execution_end',
          toolCallId: 'call_1',
          toolName: 'web_fetch',
          result: {
            content: [{ type: 'text', text: '正文' }],
            details: { summary: '已抓取 a.test', audit: { status: 200 } },
          },
          isError: false,
        },
        { type: 'turn_start' },
        { type: 'message_start', message: assistantMessage() },
        update({ type: 'text_delta', contentIndex: 0, delta: '答', partial: assistantMessage() }),
        update({ type: 'text_delta', contentIndex: 0, delta: '案', partial: assistantMessage() }),
        { type: 'message_end', message: assistantMessage() },
      ]),
      ...projector.finalize('succeeded'),
    ]

    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index))
    expect(events.map((event) => event.type)).toEqual([
      'run-status',
      'message-start',
      'reasoning-delta',
      'tool-call',
      'message-end',
      'tool-status',
      'tool-result',
      'message-start',
      'text-delta',
      'text-delta',
      'message-end',
      'usage',
      'run-terminal',
    ])

    const usageEvent = events.find((event) => event.type === 'usage')
    expect(usageEvent).toMatchObject({
      usage: { modelCalls: 2, toolCalls: 1, webFetchCalls: 1 },
    })
    expect(events.at(-1)).toMatchObject({
      type: 'run-terminal',
      status: 'succeeded',
      limitReason: null,
    })

    const snapshot = projector.messagesSnapshot()
    expect(snapshot).toEqual([
      {
        id: 'msg_1',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: '先思考' },
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'web_fetch',
            args: { url: 'https://a.test' },
          },
        ],
      },
      {
        id: 'msg_2',
        role: 'tool',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'web_fetch',
            status: 'succeeded',
            isError: false,
            summary: '已抓取 a.test',
            audit: { status: 200 },
          },
        ],
      },
      {
        id: 'msg_3',
        role: 'assistant',
        parts: [{ type: 'text', text: '答案' }],
      },
    ])

    const toolCall = projector.toolCallRecords()[0]
    expect(toolCall).toMatchObject({ toolCallId: 'call_1', status: 'succeeded', isError: false })
  })

  it('redacts write_file content from persisted events and tool-call records', () => {
    const projector = new AgentRunProjector(runId, idFactory())
    const events = drive(projector, [
      { type: 'message_start', message: assistantMessage() },
      update({
        type: 'toolcall_end',
        contentIndex: 0,
        toolCall: {
          type: 'toolCall',
          id: 'call-write',
          name: 'write_file',
          arguments: { path: '/workspace/output/result.svg', content: '<svg>secret</svg>' },
        },
        partial: assistantMessage(),
      }),
      {
        type: 'tool_execution_start',
        toolCallId: 'call-write',
        toolName: 'write_file',
        args: { path: '/workspace/output/result.svg', content: '<svg>secret</svg>' },
      },
    ])

    expect(events.find((event) => event.type === 'tool-call')).toMatchObject({
      args: {
        path: '/workspace/output/result.svg',
        content: '[omitted 17 bytes]',
      },
    })
    expect(projector.toolCallRecords()[0]?.args).toMatchObject({
      content: '[omitted 17 bytes]',
    })
    expect(JSON.stringify(projector.messagesSnapshot())).not.toContain('<svg>secret</svg>')
  })

  it('projects an exported artifact as a replayable file-operation event', () => {
    const projector = new AgentRunProjector(runId, idFactory())
    const events = drive(projector, [
      {
        type: 'tool_execution_start',
        toolCallId: 'call-export',
        toolName: 'export_file',
        args: { path: '/workspace/output/logo.svg' },
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'call-export',
        toolName: 'export_file',
        result: {
          content: [{ type: 'text', text: 'exported' }],
          details: {
            summary: '已导出产物 logo.svg',
            audit: {
              fileId: '00000000-0000-4000-8000-000000000001',
              path: '/workspace/output/logo.svg',
              size: 42,
              sha256: 'a'.repeat(64),
            },
          },
        },
        isError: false,
      },
    ])

    expect(events.map((event) => event.type)).toEqual([
      'tool-status',
      'tool-result',
      'file-operation',
    ])
    expect(events.at(-1)).toMatchObject({
      type: 'file-operation',
      status: 'succeeded',
      operation: 'export-output',
      direction: 'output',
      fileId: '00000000-0000-4000-8000-000000000001',
      path: '/workspace/output/logo.svg',
      size: 42,
      sha256: 'a'.repeat(64),
    })
  })

  it('emits a normalized error event and failed terminal', () => {
    const projector = new AgentRunProjector(runId, idFactory())
    projector.start()
    projector.recordFailure({ code: 'AGENT_STREAM_ERROR', message: '上游失败', retryable: true })
    const events = projector.finalize('failed')

    expect(events.map((event) => event.type)).toEqual(['usage', 'error', 'run-terminal'])
    expect(events.find((event) => event.type === 'error')).toMatchObject({
      error: { code: 'AGENT_STREAM_ERROR', message: '上游失败', retryable: true },
    })
    expect(events.at(-1)).toMatchObject({ type: 'run-terminal', status: 'failed' })
  })

  it('supports cancelled, limit_reached and interrupted terminals', () => {
    const cancelled = new AgentRunProjector(runId, idFactory())
    cancelled.start()
    expect(cancelled.finalize('cancelled').at(-1)).toMatchObject({ status: 'cancelled' })

    const limited = new AgentRunProjector(runId, idFactory())
    limited.start()
    expect(
      limited.finalize('limit_reached', { limitReason: 'web_fetch_calls' }).at(-1),
    ).toMatchObject({
      status: 'limit_reached',
      limitReason: 'web_fetch_calls',
    })

    const interrupted = new AgentRunProjector(runId, idFactory())
    interrupted.start()
    expect(interrupted.finalize('interrupted').at(-1)).toMatchObject({ status: 'interrupted' })
  })

  it('closes an open assistant message when finalized mid-stream (cancel)', () => {
    const projector = new AgentRunProjector(runId, idFactory())
    projector.start()
    drive(projector, [
      { type: 'message_start', message: assistantMessage() },
      update({ type: 'text_delta', contentIndex: 0, delta: '进行中', partial: assistantMessage() }),
    ])
    const events = projector.finalize('cancelled')
    expect(events.map((event) => event.type)).toEqual(['message-end', 'usage', 'run-terminal'])
    expect(projector.messagesSnapshot()).toEqual([
      { id: 'msg_1', role: 'assistant', parts: [{ type: 'text', text: '进行中' }] },
    ])
  })

  it('is idempotent on repeated finalize and rejects invalid terminal status', () => {
    const projector = new AgentRunProjector(runId, idFactory())
    projector.start()
    expect(projector.finalize('succeeded')).toHaveLength(2)
    expect(projector.finalize('failed')).toEqual([])
    const fresh = new AgentRunProjector(runId, idFactory())
    fresh.start()
    expect(() => fresh.finalize('running' as never)).toThrow()
  })

  it('marks usage unknown when any model call reports unknown usage', () => {
    const projector = new AgentRunProjector(runId, idFactory())
    projector.start()
    projector.addUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15, usageUnknown: false })
    projector.addUsage({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      usageUnknown: true,
    })
    const events = projector.finalize('succeeded')
    expect(events.find((event) => event.type === 'usage')).toMatchObject({
      usage: { usageUnknown: true, inputTokens: null },
    })
  })
})
