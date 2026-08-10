import assert from 'node:assert/strict'
import test from 'node:test'

import type { AgentEvent } from '@earendil-works/pi-agent-core'

import type { ModelInvocationPort, ModelInvocationRequest } from '../src/chat/model-invocation.port'
import { loadPiAgentCore } from '../src/agent/pi-runtime'
import { createPiModel, createPiStreamFn } from '../src/agent/pi-stream-bridge'
import { toPiAgentTool } from '../src/agent/pi-tool.adapter'
import type { AgentToolDefinition } from '../src/agent/tools/agent-tool'
import { AgentToolExecutionError } from '../src/agent/tools/agent-tool'
import { AgentToolRegistry } from '../src/agent/tools/agent-tool.registry'

test('Pi converts one structured tool exception without project-level retry or replay', async () => {
  const { Agent } = await loadPiAgentCore()
  const requests: ModelInvocationRequest[] = []
  let modelCalls = 0
  let toolExecutions = 0
  const port: ModelInvocationPort = {
    async *invoke(request) {
      requests.push(request)
      modelCalls += 1
      if (modelCalls === 1) {
        yield {
          type: 'tool-call',
          toolCall: { id: 'call-1', name: 'read_file', arguments: { path: '/missing.txt' } },
        }
        yield {
          type: 'finish',
          finishReason: 'tool_calls',
          provider: 'qwen',
          resolvedModel: 'mock-agent',
        }
        return
      }
      yield { type: 'text', delta: '我会改用现有路径。' }
      yield {
        type: 'finish',
        finishReason: 'stop',
        provider: 'qwen',
        resolvedModel: 'mock-agent',
      }
    },
  }
  const definition: AgentToolDefinition = {
    name: 'read_file',
    description: 'read',
    label: '读取文件',
    riskLevel: 'read',
    approvalPolicy: 'none',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: { path: { type: 'string' } },
    },
    execute: async () => {
      toolExecutions += 1
      throw new AgentToolExecutionError({
        code: 'FILE_NOT_FOUND',
        message: '文件 /missing.txt 不存在。请先检查目录并改用存在的路径。',
        summary: '文件不存在',
        retryable: true,
        audit: { path: '/missing.txt' },
      })
    },
  }
  const registry = new AgentToolRegistry([definition])
  const agent = new Agent({
    initialState: {
      systemPrompt: '测试',
      model: createPiModel('mock-agent', 'qwen'),
      tools: [toPiAgentTool(definition, registry, { runId: 'run-1', userId: 'user-1' })],
    },
    streamFn: createPiStreamFn({ port, createRequestId: () => `request-${modelCalls + 1}` }),
  })
  const events: AgentEvent[] = []
  agent.subscribe((event) => events.push(event))

  await agent.prompt('读取文件')

  assert.equal(toolExecutions, 1)
  assert.equal(modelCalls, 2)
  assert.equal(events.filter((event) => event.type === 'tool_execution_start').length, 1)
  assert.equal(events.filter((event) => event.type === 'tool_execution_end').length, 1)
  assert.deepEqual(
    events.find((event) => event.type === 'tool_execution_end'),
    {
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'read_file',
      isError: true,
      result: {
        content: [
          {
            type: 'text',
            text: '文件 /missing.txt 不存在。请先检查目录并改用存在的路径。',
          },
        ],
        details: {},
      },
    },
  )
  assert.ok(
    requests[1]?.messages.some(
      (message) =>
        message.role === 'tool' &&
        message.toolCallId === 'call-1' &&
        message.toolName === 'read_file' &&
        message.content === '文件 /missing.txt 不存在。请先检查目录并改用存在的路径。',
    ),
  )
})
