import type { AgentToolDefinition } from './tools/agent-tool'
import { AgentToolRegistry } from './tools/agent-tool.registry'
import { toPiAgentTool } from './pi-tool.adapter'

describe('toPiAgentTool error projection', () => {
  it('keeps the normalized code and actionable message after Pi catches the error', async () => {
    const definition: AgentToolDefinition = {
      name: 'write_file',
      description: 'write',
      label: '写入文件',
      riskLevel: 'write',
      approvalPolicy: 'none',
      parameters: { type: 'object', additionalProperties: true },
      execute: async () => ({
        content: 'Run Sandbox 尚未创建',
        summary: '写入文件失败',
        isError: true,
        audit: { code: 'SANDBOX_UNAVAILABLE', retryable: true },
      }),
    }
    const registry = new AgentToolRegistry([definition])
    const tool = toPiAgentTool(definition, registry, { runId: 'run-1', userId: 'user-1' })

    await expect(tool.execute('call-1', {}, new AbortController().signal)).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE',
      message: '[SANDBOX_UNAVAILABLE] Run Sandbox 尚未创建',
    })
  })

  it('prepares model arguments before registry validation', async () => {
    let received: unknown
    const definition: AgentToolDefinition = {
      name: 'probe',
      description: 'probe',
      label: 'Probe',
      riskLevel: 'read',
      approvalPolicy: 'none',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['items'],
        properties: { items: { type: 'array' } },
      },
      prepareArguments: (raw) => ({
        ...(raw as Record<string, unknown>),
        items: JSON.parse(String((raw as Record<string, unknown>).items)),
      }),
      executionMode: 'sequential',
      execute: async (args) => {
        received = args
        return { content: 'ok', summary: 'ok', isError: false }
      },
    }
    const registry = new AgentToolRegistry([definition])
    const tool = toPiAgentTool(definition, registry, { runId: 'run-1', userId: 'user-1' })

    await tool.execute('call-1', { items: '[1,2]' }, new AbortController().signal)

    expect(received).toEqual({ items: [1, 2] })
    expect(tool.executionMode).toBe('sequential')
  })
})
