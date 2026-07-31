import assert from 'node:assert/strict'
import test from 'node:test'

import type { AgentMessage, AgentStreamEvent, AIGatewayClient } from '@supermind/sdk'

import { agentMessagesToThreadMessages, createAgentRunAdapter } from './agent-run-adapter'

test('merges tool results into the preceding assistant tool-call part', () => {
  const messages: AgentMessage[] = [
    {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: '总结 https://example.com/' }],
      createdAt: '2026-07-20T00:00:00.000Z',
    },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: '需要检索' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'web_fetch',
          args: { url: 'https://example.com/' },
        },
      ],
      createdAt: '2026-07-20T00:00:01.000Z',
    },
    {
      id: 't1',
      role: 'tool',
      parts: [
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'web_fetch',
          status: 'succeeded',
          isError: false,
          summary: '已抓取 example.com',
          audit: { status: 200, finalUrl: 'https://example.com/' },
        },
      ],
      createdAt: '2026-07-20T00:00:02.000Z',
    },
    {
      id: 'a2',
      role: 'assistant',
      parts: [{ type: 'text', text: '页面是 Example Domain' }],
      createdAt: '2026-07-20T00:00:03.000Z',
    },
  ]

  const threadMessages = agentMessagesToThreadMessages(messages)
  assert.equal(threadMessages.length, 2)
  assert.equal(threadMessages[0]?.role, 'user')

  const assistant = threadMessages[1]
  assert.equal(assistant?.role, 'assistant')
  assert.deepEqual(assistant && 'content' in assistant ? assistant.content : null, [
    { type: 'reasoning', text: '需要检索' },
    {
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'web_fetch',
      args: { url: 'https://example.com/' },
      argsText: '{"url":"https://example.com/"}',
      result: {
        summary: '已抓取 example.com',
        status: 'succeeded',
        audit: { status: 200, finalUrl: 'https://example.com/' },
      },
      isError: false,
    },
    { type: 'text', text: '页面是 Example Domain' },
  ])
})

test('marks the last assistant message incomplete when last run was interrupted', () => {
  const messages: AgentMessage[] = [
    {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: '任务' }],
      createdAt: '2026-07-20T00:00:00.000Z',
    },
    {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: '半成品' }],
      createdAt: '2026-07-20T00:00:01.000Z',
    },
  ]
  const threadMessages = agentMessagesToThreadMessages(messages, { lastRunStatus: 'interrupted' })
  const assistant = threadMessages[1]
  assert.equal(assistant?.role, 'assistant')
  assert.deepEqual(assistant && 'status' in assistant ? assistant.status : null, {
    type: 'incomplete',
    reason: 'error',
    error: '服务重启导致运行中断，未自动重放',
  })
})

test('aborting local SSE does not call runs.cancel (browser disconnect must not cancel)', async () => {
  let cancelCalls = 0
  const abort = new AbortController()
  const events: AgentStreamEvent[] = [
    { type: 'run-status', sequence: 0, runId: 'run-1', status: 'running' },
    {
      type: 'message-start',
      sequence: 1,
      runId: 'run-1',
      messageId: 'm1',
      role: 'assistant',
    },
    { type: 'text-delta', sequence: 2, runId: 'run-1', messageId: 'm1', delta: '半' },
  ]

  const client = {
    agent: {
      threads: {
        create: async () => {
          throw new Error('should not create')
        },
      },
      runs: {
        create: async () => ({
          id: 'run-1',
          threadId: 'thread-1',
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
          lastSequence: -1,
          createdAt: '2026-07-20T00:00:00.000Z',
          startedAt: null,
          completedAt: null,
        }),
        cancel: async () => {
          cancelCalls += 1
          throw new Error('cancel must not be called on abort')
        },
        subscribe: async function* (_runId: string, options?: { signal?: AbortSignal }) {
          for (const event of events) {
            if (options?.signal?.aborted) {
              throw Object.assign(new Error('aborted'), { name: 'AbortError' })
            }
            yield event
            if (event.type === 'text-delta') {
              abort.abort()
            }
          }
          if (options?.signal?.aborted) {
            throw Object.assign(new Error('aborted'), { name: 'AbortError' })
          }
        },
      },
    },
  } as unknown as AIGatewayClient

  const adapter = createAgentRunAdapter(client, () => ({
    threadId: 'thread-1',
    model: 'mock',
    thinkingEffort: 'balanced',
    selectedSkillNames: [],
    onThreadCreated: () => undefined,
  }))

  const messages = [
    {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: '继续' }],
      id: 'u1',
      createdAt: new Date(),
    },
  ]

  const collected: unknown[] = []
  const stream = adapter.run({
    messages: messages as never,
    abortSignal: abort.signal,
    context: {} as never,
    unstable_getMessage: () => messages[0] as never,
  } as never) as AsyncGenerator<unknown>

  for await (const chunk of stream) {
    collected.push(chunk)
  }

  assert.equal(cancelCalls, 0)
  assert.ok(collected.length >= 1)
})

test('forwards live Sandbox status events to the workspace status module', async () => {
  const received: Array<{ status: string; sandboxId?: string }> = []
  const client = {
    agent: {
      runs: {
        create: async () => ({ id: 'run-1', threadId: 'thread-1' }),
        subscribe: async function* () {
          yield {
            type: 'sandbox-status',
            sequence: 0,
            runId: 'run-1',
            status: 'creating',
          } as const
          yield {
            type: 'sandbox-status',
            sequence: 1,
            runId: 'run-1',
            status: 'ready',
            sandboxId: 'sandbox-1',
          } as const
          yield {
            type: 'run-terminal',
            sequence: 2,
            runId: 'run-1',
            status: 'succeeded',
            limitReason: null,
          } as const
        },
      },
    },
  } as unknown as AIGatewayClient
  const adapter = createAgentRunAdapter(client, () => ({
    threadId: 'thread-1',
    model: 'mock',
    thinkingEffort: 'balanced',
    selectedSkillNames: [],
    onThreadCreated: () => undefined,
    onSandboxStatus: (status, sandboxId) => {
      received.push({ status, ...(sandboxId === undefined ? {} : { sandboxId }) })
    },
  }))

  for await (const chunk of adapter.run({
    messages: [{ role: 'user', content: [{ type: 'text', text: '执行' }] }],
    abortSignal: new AbortController().signal,
  } as never) as AsyncGenerator<unknown>) {
    // Consume the whole run so both Sandbox events are observed.
    void chunk
  }

  assert.deepEqual(received, [{ status: 'creating' }, { status: 'ready', sandboxId: 'sandbox-1' }])
})

test('reports progress until the first renderable Agent event arrives', async () => {
  const progress: Array<string | null> = []
  const client = {
    agent: {
      runs: {
        create: async () => ({ id: 'run-1', threadId: 'thread-1' }),
        subscribe: async function* () {
          yield {
            type: 'sandbox-status',
            sequence: 0,
            runId: 'run-1',
            status: 'ready',
            sandboxId: 'sandbox-1',
          } as const
          yield {
            type: 'text-delta',
            sequence: 1,
            runId: 'run-1',
            messageId: 'message-1',
            delta: '已开始处理。',
          } as const
          yield {
            type: 'run-terminal',
            sequence: 2,
            runId: 'run-1',
            status: 'succeeded',
            limitReason: null,
          } as const
        },
      },
    },
  } as unknown as AIGatewayClient
  const adapter = createAgentRunAdapter(client, () => ({
    threadId: 'thread-1',
    model: 'mock',
    thinkingEffort: 'balanced',
    selectedSkillNames: [],
    onThreadCreated: () => undefined,
    onRunProgressChange: (stage) => progress.push(stage),
  }))

  for await (const chunk of adapter.run({
    messages: [{ role: 'user', content: [{ type: 'text', text: '执行' }] }],
    abortSignal: new AbortController().signal,
  } as never) as AsyncGenerator<unknown>) {
    void chunk
  }

  assert.deepEqual(progress, ['starting-run', 'preparing-sandbox', 'thinking', null, null])
})

test('waits for limit terminal after a context error and releases the active run', async () => {
  let finished = 0
  let createInput: unknown
  const client = {
    agent: {
      runs: {
        create: async (_threadId: string, input: unknown) => {
          createInput = input
          return { id: 'run-1', threadId: 'thread-1' }
        },
        subscribe: async function* () {
          yield {
            type: 'error',
            sequence: 0,
            runId: 'run-1',
            error: {
              requestId: 'run-1',
              code: 'AGENT_CONTEXT_COMPRESSION_FAILED',
              message: '摘要失败',
              retryable: false,
            },
          } as const
          yield {
            type: 'run-terminal',
            sequence: 1,
            runId: 'run-1',
            status: 'limit_reached',
            limitReason: 'context_window',
          } as const
        },
      },
    },
  } as unknown as AIGatewayClient
  const adapter = createAgentRunAdapter(client, () => ({
    threadId: 'thread-1',
    model: 'qwen',
    thinkingEffort: 'deep',
    selectedSkillNames: ['mock-data-cleaner'],
    onThreadCreated: () => undefined,
    onRunFinished: () => {
      finished += 1
    },
  }))
  const chunks: unknown[] = []
  for await (const chunk of adapter.run({
    messages: [{ role: 'user', content: [{ type: 'text', text: '继续' }] }],
    abortSignal: new AbortController().signal,
  } as never) as AsyncGenerator<unknown>)
    chunks.push(chunk)
  assert.deepEqual(createInput, {
    input: '继续',
    thinkingEffort: 'deep',
    skills: [{ name: 'mock-data-cleaner' }],
  })
  assert.equal(finished, 1)
  assert.equal((chunks.at(-1) as { status: { type: string } }).status.type, 'incomplete')
})
