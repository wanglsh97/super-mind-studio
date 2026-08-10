import type { AgentStreamEvent } from '@supermind/sdk'

import { AgentRunEventBus } from './agent-run-event-bus'

describe('AgentRunEventBus', () => {
  it('isolates a failed progress listener from other listeners and final events', () => {
    const bus = new AgentRunEventBus()
    const received: AgentStreamEvent[] = []
    const progress: AgentStreamEvent = {
      type: 'tool-progress',
      sequence: 1,
      runId: 'run-1',
      toolCallId: 'call-1',
      toolName: 'shell',
      content: '正在执行',
    }
    const result: AgentStreamEvent = {
      type: 'tool-result',
      sequence: 2,
      runId: 'run-1',
      toolCallId: 'call-1',
      toolName: 'shell',
      status: 'succeeded',
      isError: false,
      summary: '执行完成',
    }

    bus.open('run-1')
    bus.subscribe('run-1', (event) => {
      if (event.type === 'tool-progress') throw new Error('SSE client disconnected')
    })
    bus.subscribe('run-1', (event) => received.push(event))

    expect(() => bus.publish('run-1', progress)).not.toThrow()
    expect(() => bus.publish('run-1', result)).not.toThrow()
    expect(received).toEqual([progress, result])
  })
})
