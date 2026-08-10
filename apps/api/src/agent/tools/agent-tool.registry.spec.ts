import type { AgentToolDefinition } from './agent-tool'
import { AgentToolExecutionError } from './agent-tool'
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

describe('web_fetch contract helpers', () => {
  it('builds success/error results and strips sensitive audit keys', () => {
    const ok = createWebFetchSuccessResult({
      content: 'body',
      summary: 'ok',
      audit: { requestedUrl: 'https://a.test', status: 200, truncated: false },
    })
    expect(ok.isError).toBe(false)
    expect(ok.audit?.status).toBe(200)

    const failed = createWebFetchErrorResult({
      code: 'WEB_FETCH_INVALID_ARGS',
      message: 'bad',
    })
    expect(failed.isError).toBe(true)
    expect(failed.audit?.errorCode).toBe('WEB_FETCH_INVALID_ARGS')

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
