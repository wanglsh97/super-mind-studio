import type { AgentToolDefinition } from './agent-tool'
import { AgentToolExecutionError, sanitizeToolAudit, sanitizeToolErrorMessage } from './agent-tool'
import {
  AgentToolNotRegisteredError,
  AgentToolRegistry,
  DuplicateAgentToolError,
  UnsupportedAgentToolApprovalError,
} from './agent-tool.registry'
import { validateToolArguments } from './tool-args.validation'
import {
  WEB_FETCH_TOOL_PARAMETERS,
  createWebFetchErrorResult,
  createWebFetchSuccessResult,
  sanitizeWebFetchAudit,
} from './web-fetch/contract'
import { webFetchFixtureTool } from './web-fetch/fixture.tool'
import { TelemetryService } from '../../observability/telemetry.service'

function fakeTool(name: string, execute?: AgentToolDefinition['execute']): AgentToolDefinition {
  return {
    name,
    description: name,
    label: name,
    riskLevel: 'read',
    approvalPolicy: 'none',
    parameters: { type: 'object', additionalProperties: true },
    execute: execute ?? (async () => ({ content: '', summary: '', isError: false })),
  }
}

describe('validateToolArguments', () => {
  it('accepts schema-valid web_fetch args', () => {
    const result = validateToolArguments(WEB_FETCH_TOOL_PARAMETERS, {
      url: 'https://example.com/',
    })
    expect(result).toEqual({ ok: true, args: { url: 'https://example.com/' } })
  })

  it('rejects missing url, wrong types and extra properties', () => {
    expect(validateToolArguments(WEB_FETCH_TOOL_PARAMETERS, {}).ok).toBe(false)
    expect(validateToolArguments(WEB_FETCH_TOOL_PARAMETERS, { url: 1 }).ok).toBe(false)
    expect(validateToolArguments(WEB_FETCH_TOOL_PARAMETERS, { url: '' }).ok).toBe(false)
    expect(
      validateToolArguments(WEB_FETCH_TOOL_PARAMETERS, {
        url: 'https://example.com/',
        headers: { Authorization: 'secret' },
      }).ok,
    ).toBe(false)
  })
})

describe('AgentToolExecutionError', () => {
  it('keeps Pi-compatible text while redacting and bounding model-visible diagnostics', () => {
    const longTail = 'x'.repeat(5_000)
    const error = new AgentToolExecutionError({
      code: 'AGENT_TOOL_FAILED',
      message: `Authorization: Bearer secret-token password=hunter2 ${longTail}`,
      summary: '失败',
      retryable: true,
      audit: {
        path: '/workspace/work/a.txt',
        token: 'secret-token',
        nested: { password: 'hunter2', status: 500 },
      },
    })

    expect(error.message).not.toContain('secret-token')
    expect(error.message).not.toContain('hunter2')
    expect(error.message.length).toBeLessThanOrEqual(4_012)
    expect(error.audit).toEqual({
      path: '/workspace/work/a.txt',
      nested: { status: 500 },
    })
  })

  it('exports reusable sanitizers for tool-specific messages and audit context', () => {
    expect(sanitizeToolErrorMessage('token=abc')).toBe('token=[REDACTED]')
    expect(sanitizeToolAudit({ cookie: 'a=1', status: 429 })).toEqual({ status: 429 })
  })
})

describe('web_fetch contract helpers', () => {
  it('builds success/error results and strips sensitive audit keys', () => {
    const ok = createWebFetchSuccessResult({
      content: 'body',
      summary: 'ok',
      audit: { requestedUrl: 'https://a.test', status: 200, truncated: false },
    })
    expect(ok.isError).toBe(false)
    expect(ok.audit?.status).toBe(200)

    expect(() =>
      createWebFetchErrorResult({
        code: 'WEB_FETCH_INVALID_ARGS',
        message: 'bad',
      }),
    ).toThrow(expect.objectContaining({ code: 'WEB_FETCH_INVALID_ARGS' }))

    expect(
      sanitizeWebFetchAudit({
        requestedUrl: 'https://a.test',
        cookie: 'session=1',
        Authorization: 'Bearer x',
      } as never),
    ).toEqual({ requestedUrl: 'https://a.test' })
  })
})

describe('AgentToolRegistry', () => {
  it('retains TelemetryService runtime injection metadata', () => {
    expect(Reflect.getMetadata('design:paramtypes', AgentToolRegistry)?.[1]).toBe(TelemetryService)
  })

  it('resolves registered tools and rejects unknown ones', () => {
    const registry = new AgentToolRegistry([webFetchFixtureTool])
    expect(registry.has('web_fetch')).toBe(true)
    expect(registry.get('web_fetch').name).toBe('web_fetch')
    expect(registry.has('nonexistent_tool')).toBe(false)
    expect(() => registry.get('nonexistent_tool')).toThrow(AgentToolNotRegisteredError)
  })

  it('rejects duplicate tool names', () => {
    expect(() => new AgentToolRegistry([fakeTool('dup'), fakeTool('dup')])).toThrow(
      DuplicateAgentToolError,
    )
  })

  it('rejects tools that require an unavailable approval flow', () => {
    const tool = fakeTool('write_probe')
    tool.riskLevel = 'write'
    tool.approvalPolicy = 'explicit'
    expect(() => new AgentToolRegistry([tool])).toThrow(UnsupportedAgentToolApprovalError)
  })

  it('lists registered tools', () => {
    const registry = new AgentToolRegistry([fakeTool('a'), fakeTool('b')])
    expect(registry.list().map((tool) => tool.name)).toEqual(['a', 'b'])
  })

  it('execute rejects unknown tools and invalid args without calling tool execute', async () => {
    let called = 0
    const tool = fakeTool('probe', async () => {
      called += 1
      return { content: 'ran', summary: 'ran', isError: false }
    })
    tool.parameters = WEB_FETCH_TOOL_PARAMETERS
    const registry = new AgentToolRegistry([tool])
    const context = { toolCallId: 't1', signal: new AbortController().signal }

    await expect(registry.execute('missing', { url: 'https://a.test' }, context)).rejects.toThrow(
      AgentToolNotRegisteredError,
    )
    expect(called).toBe(0)

    await expect(registry.execute('probe', { url: '' }, context)).rejects.toMatchObject({
      code: 'AGENT_TOOL_INVALID_ARGS',
      retryable: true,
    })
    expect(called).toBe(0)

    await expect(
      registry.execute('probe', { url: 'https://a.test', Authorization: 'nope' }, context),
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_INVALID_ARGS' })
    expect(called).toBe(0)
  })

  it('execute propagates AbortSignal before invoking the tool', async () => {
    let called = 0
    const tool = fakeTool('probe', async () => {
      called += 1
      return { content: 'ran', summary: 'ran', isError: false }
    })
    const registry = new AgentToolRegistry([tool])
    const controller = new AbortController()
    controller.abort()
    await expect(
      registry.execute('probe', {}, { toolCallId: 't1', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AgentToolExecutionError', code: 'AGENT_TOOL_ABORTED' })
    expect(called).toBe(0)
  })

  it('wraps an unknown implementation exception without changing known tool errors', async () => {
    const cause = new Error('provider exploded')
    const unknown = new AgentToolRegistry([
      fakeTool('unknown', async () => {
        throw cause
      }),
    ])
    const wrapped = await unknown
      .execute('unknown', {}, { toolCallId: 't1', signal: new AbortController().signal })
      .catch((error: unknown) => error)
    expect(wrapped).toBeInstanceOf(AgentToolExecutionError)
    expect(wrapped).toMatchObject({ code: 'AGENT_TOOL_FAILED' })
    expect((wrapped as AgentToolExecutionError).message).toBe('provider exploded')
    expect((wrapped as Error & { cause?: unknown }).cause).toBe(cause)

    const knownError = new AgentToolExecutionError({
      code: 'KNOWN_FAILURE',
      message: '具体失败原因。请修改参数后重试。',
      retryable: true,
    })
    const known = new AgentToolRegistry([
      fakeTool('known', async () => {
        throw knownError
      }),
    ])
    await expect(
      known.execute('known', {}, { toolCallId: 't2', signal: new AbortController().signal }),
    ).rejects.toBe(knownError)
  })

  it('does not let telemetry startup failures change a successful tool result', async () => {
    const telemetry = {
      startSpan: jest.fn(() => {
        throw new Error('otel unavailable')
      }),
      recordToolInvocation: jest.fn(() => {
        throw new Error('metrics unavailable')
      }),
    } as unknown as TelemetryService
    const registry = new AgentToolRegistry(
      [fakeTool('probe', async () => ({ content: 'ok', summary: 'ok', isError: false }))],
      telemetry,
    )

    await expect(
      registry.execute('probe', {}, { toolCallId: 't1', signal: new AbortController().signal }),
    ).resolves.toEqual({ content: 'ok', summary: 'ok', isError: false })
  })

  it('does not let telemetry completion failures replace the original tool error', async () => {
    const telemetry = {
      startSpan: jest.fn(() => ({})),
      endSpan: jest.fn(() => {
        throw new Error('otel exporter failed')
      }),
      recordToolInvocation: jest.fn(() => {
        throw new Error('metrics exporter failed')
      }),
    } as unknown as TelemetryService
    const toolError = new AgentToolExecutionError({
      code: 'SHELL_EXIT_NONZERO',
      message: '命令退出码为 1。请检查命令输出后修正。',
      retryable: true,
    })
    const registry = new AgentToolRegistry(
      [
        fakeTool('shell', async () => {
          throw toolError
        }),
      ],
      telemetry,
    )

    await expect(
      registry.execute('shell', {}, { toolCallId: 't1', signal: new AbortController().signal }),
    ).rejects.toBe(toolError)
  })
})

describe('webFetchFixtureTool', () => {
  const context = { toolCallId: 't1', signal: new AbortController().signal }

  it('returns deterministic content and audit for a valid URL', async () => {
    const result = await webFetchFixtureTool.execute({ url: 'https://example.com/' }, context)
    expect(result.isError).toBe(false)
    expect(result.content).toContain('https://example.com/')
    expect(result.audit).toMatchObject({
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      status: 200,
      truncated: false,
    })
  })

  it('rejects missing url, invalid url and non-http protocols', async () => {
    await expect(webFetchFixtureTool.execute({ url: '' }, context)).rejects.toMatchObject({
      name: 'AgentToolExecutionError',
      code: 'WEB_FETCH_INVALID_ARGS',
    })
    await expect(webFetchFixtureTool.execute({ url: 'not a url' }, context)).rejects.toMatchObject({
      code: 'WEB_FETCH_INVALID_URL',
    })
    await expect(
      webFetchFixtureTool.execute({ url: 'ftp://example.com' }, context),
    ).rejects.toMatchObject({ code: 'WEB_FETCH_UNSUPPORTED_PROTOCOL' })
    await expect(
      webFetchFixtureTool.execute({ url: 'http://localhost/secret' }, context),
    ).rejects.toMatchObject({ code: 'WEB_FETCH_BLOCKED_TARGET' })
    await expect(
      webFetchFixtureTool.execute({ url: 'https://user:pass@example.com/' }, context),
    ).rejects.toMatchObject({ code: 'WEB_FETCH_BLOCKED_TARGET' })
  })

  it('honors AbortSignal during slow.test delay', async () => {
    const controller = new AbortController()
    const pending = webFetchFixtureTool.execute(
      { url: 'https://slow.test/page' },
      { toolCallId: 't1', signal: controller.signal },
    )
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(AgentToolExecutionError)
  })
})
