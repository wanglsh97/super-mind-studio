import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createAIGatewayClient } from './client.js'
import { AIGatewayError, AIGatewayProtocolError } from './errors.js'
import { SkillUploadTransportError } from './skill-upload.js'
import type { AgentStreamEvent } from './agent-types.js'

const runId = '00000000-0000-4000-8000-0000000000f0'
const threadId = '00000000-0000-4000-8000-0000000000f1'

describe('AgentClient Token analytics', () => {
  it('requests the browser timezone projection and decodes usage dimensions', async () => {
    const urls: string[] = []
    const client = createAIGatewayClient({
      fetch: async (input) => {
        urls.push(String(input))
        return Response.json({
          from: '2026-04-29',
          to: '2026-07-29',
          timezoneOffsetMinutes: 420,
          daily: [
            {
              date: '2026-07-29',
              inputTokens: 10,
              outputTokens: 4,
              totalTokens: 14,
              cachedInputTokens: 3,
              reasoningTokens: 2,
              modelCalls: 1,
              cacheRate: 0.3,
            },
          ],
          models: [
            {
              model: 'qwen3.7-plus',
              inputTokens: 10,
              outputTokens: 4,
              totalTokens: 14,
              cachedInputTokens: 3,
              reasoningTokens: 2,
              modelCalls: 1,
              cacheRate: 0.3,
            },
          ],
        })
      },
    })

    const analytics = await client.agent.analytics.get({ timezoneOffsetMinutes: 420 })

    assert.equal(urls[0], '/api/v1/agent/token-analytics?timezoneOffsetMinutes=420')
    assert.equal(analytics.daily[0]?.cachedInputTokens, 3)
    assert.equal(analytics.models[0]?.model, 'qwen3.7-plus')
  })
})

describe('AgentClient MCP status', () => {
  it('lists a credential-free MCP Server status projection', async () => {
    const urls: string[] = []
    const client = createAIGatewayClient({
      baseUrl: 'http://localhost:3001',
      fetch: async (input) => {
        urls.push(String(input))
        return Response.json([
          {
            id: 'docs',
            name: 'Docs',
            version: '1.0.0',
            description: 'Approved docs',
            enabled: true,
            status: 'ready',
            allowedToolCount: 2,
            discoveredToolCount: 3,
            registeredToolCount: 2,
            errorCode: null,
          },
        ])
      },
    })

    const statuses = await client.agent.mcp.servers()

    assert.equal(urls[0], 'http://localhost:3001/api/v1/agent/mcp/servers')
    assert.deepEqual(statuses, [
      {
        id: 'docs',
        name: 'Docs',
        version: '1.0.0',
        description: 'Approved docs',
        enabled: true,
        status: 'ready',
        allowedToolCount: 2,
        discoveredToolCount: 3,
        registeredToolCount: 2,
        errorCode: null,
      },
    ])
    assert.doesNotMatch(JSON.stringify(statuses), /url|token|auth/i)
  })

  it('updates only a built-in MCP Server enablement flag', async () => {
    const calls: Array<{
      url: string
      method: string | undefined
      body: BodyInit | null | undefined
    }> = []
    const client = createAIGatewayClient({
      fetch: async (input, init) => {
        calls.push({ url: String(input), method: init?.method, body: init?.body })
        return Response.json({
          id: 'context7',
          name: 'Context7',
          version: '3.2.5',
          description: 'Library docs',
          enabled: false,
          status: 'disabled',
          allowedToolCount: 2,
          discoveredToolCount: 0,
          registeredToolCount: 0,
          errorCode: null,
        })
      },
    })

    const result = await client.agent.mcp.update('context/7', { enabled: false })

    assert.equal(calls[0]?.url, '/api/v1/agent/mcp/servers/context%2F7')
    assert.equal(calls[0]?.method, 'PATCH')
    assert.equal(calls[0]?.body, JSON.stringify({ enabled: false }))
    assert.equal(result.enabled, false)
    assert.equal(result.status, 'disabled')
  })

  it('rejects malformed MCP Server status projections', async () => {
    const client = createAIGatewayClient({
      fetch: async () =>
        Response.json([{ id: 'docs', status: 'ready', url: 'https://secret.example' }]),
    })

    await assert.rejects(() => client.agent.mcp.servers(), AIGatewayProtocolError)
  })
})

describe('AgentClient skills', () => {
  it('lists, installs, updates and uninstalls Skills with credentials and encoded ids', async () => {
    const calls: Array<{
      url: string
      method: string | undefined
      body: unknown
      credentials: RequestCredentials | undefined
    }> = []
    const client = createAIGatewayClient({
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          method: init?.method,
          body: init?.body,
          credentials: init?.credentials,
        })
        if (init?.method === 'DELETE') return new Response(null, { status: 204 })
        if (String(input).endsWith('/skills/executable/candidates')) {
          return Response.json([
            {
              id: 'skill-1',
              name: 'mock-data-cleaner',
              title: 'Mock Data Cleaner',
              description: '清理数据',
            },
          ])
        }
        const item = {
          id: 'deep-research',
          name: '深度研究',
          version: '1.0.0',
          description: '研究',
          category: '研究',
          allowedTools: ['web_fetch'],
          installed: init?.method !== 'GET',
          enabled: init?.method !== 'GET',
        }
        return Response.json(init?.method === 'GET' ? [item] : item)
      },
    })

    await client.agent.skills.list()
    const candidates = await client.agent.skills.candidates()
    await client.agent.skills.install('deep/research')
    await client.agent.skills.update('deep-research', { enabled: false })
    await client.agent.skills.uninstall('deep-research')

    assert.equal(calls[0]?.url, '/api/v1/agent/skills')
    assert.equal(candidates[0]?.name, 'mock-data-cleaner')
    assert.equal(calls[1]?.url, '/api/v1/agent/skills/executable/candidates')
    assert.equal(calls[2]?.url, '/api/v1/agent/skills/deep%2Fresearch/install')
    assert.equal(calls[2]?.method, 'PUT')
    assert.equal(calls[3]?.method, 'PATCH')
    assert.equal(calls[3]?.body, JSON.stringify({ enabled: false }))
    assert.equal(calls[4]?.method, 'DELETE')
    assert.ok(calls.every((call) => call.credentials === 'same-origin'))
  })

  it('rejects malformed Skill catalog responses', async () => {
    const client = createAIGatewayClient({ fetch: async () => Response.json([{ id: 'broken' }]) })
    await assert.rejects(() => client.agent.skills.list(), AIGatewayProtocolError)
  })

  it('creates metadata sessions, uploads bytes only to OSS and finalizes through the SDK', async () => {
    const apiBodies: unknown[] = []
    const apiUrls: string[] = []
    let uploads = 0
    let uploadedBody: Blob | undefined
    const client = createAIGatewayClient({
      fetch: async (input, init) => {
        apiUrls.push(String(input))
        apiBodies.push(init?.body)
        const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
        if (String(input).endsWith('/finalize')) {
          return Response.json({
            sessionId: 'session-1',
            status: 'finalized',
            sizeBytes: 3,
            sha256: bodySha256,
            finalizedAt: '2026-07-23T00:01:00.000Z',
          })
        }
        assert.equal(body.sizeBytes, 3)
        assert.equal(body.sha256, bodySha256)
        return Response.json({
          id: 'session-1',
          expectedSizeBytes: 3,
          expectedSha256: bodySha256,
          expiresAt: '2026-07-23T00:05:00.000Z',
          upload: {
            url: 'https://bucket.oss.example/staging?signature=redacted',
            method: 'PUT',
            headers: { 'content-type': 'application/zip' },
            expiresAt: '2026-07-23T00:05:00.000Z',
          },
        })
      },
      skillUploadTransport: async (request) => {
        uploads += 1
        uploadedBody = request.body
        if (uploads === 1) throw new SkillUploadTransportError('temporary', true, 503)
        request.onProgress?.(request.body.size, request.body.size)
      },
    })

    const selectedPackage = new Blob(['zip'], { type: 'application/zip' })
    const result = await client.agent.skills.uploadPackage(selectedPackage, {
      maxRetries: 1,
      retryDelayMs: 0,
    })

    assert.equal(result.status, 'finalized')
    assert.equal(uploads, 2)
    assert.equal(uploadedBody, selectedPackage)
    assert.equal(apiUrls.length, 2)
    assert.ok(apiUrls[0]?.endsWith('/api/v1/agent/skills/uploads'))
    assert.ok(apiUrls[1]?.endsWith('/api/v1/agent/skills/uploads/session-1/finalize'))
    assert.ok(apiBodies.every((body) => typeof body === 'string' || body === undefined))
    assert.ok(apiBodies.every((body) => !String(body).includes('zip')))
  })
})

const bodySha256 = '4a70fe9aa6436e02c2dea340fbd1e352e4ef2d8ce6ca52ad25d4b95471fc8bf2'

function sseResponse(frames: string): Response {
  return new Response(frames, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'x-request-id': runId },
  })
}

function frame(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

async function collect(events: AsyncIterable<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = []
  for await (const event of events) out.push(event)
  return out
}

describe('AgentClient threads and runs', () => {
  it('creates, lists, renames and deletes threads with correct HTTP shapes', async () => {
    const calls: Array<{ url: string; method: string | undefined; body: unknown }> = []
    const client = createAIGatewayClient({
      baseUrl: 'http://localhost:3001',
      fetch: async (input, init) => {
        calls.push({ url: String(input), method: init?.method, body: init?.body })
        if (init?.method === 'DELETE') return new Response(null, { status: 204 })
        if (
          String(input).includes('/api/v1/agent/threads?') ||
          (init?.method === 'GET' && String(input).endsWith('/threads'))
        ) {
          return Response.json({
            items: [
              { id: threadId, title: 't', model: 'qwen3.7-plus', createdAt: '', updatedAt: '' },
            ],
            page: 1,
            pageSize: 50,
            total: 1,
            pageCount: 1,
            activeRuns: [],
          })
        }
        return Response.json({
          id: threadId,
          title: 't',
          model: 'qwen3.7-plus',
          createdAt: '',
          updatedAt: '',
        })
      },
    })

    await client.agent.threads.create({ model: 'qwen3.7-plus' })
    await client.agent.threads.list({ page: 2, pageSize: 20 })
    await client.agent.threads.get(threadId)
    await client.agent.threads.rename(threadId, { title: '新标题' })
    await client.agent.threads.delete(threadId)

    assert.equal(calls[0]?.url, 'http://localhost:3001/api/v1/agent/threads')
    assert.equal(calls[0]?.method, 'POST')
    assert.equal(calls[1]?.method, 'GET')
    assert.equal(calls[1]?.url, 'http://localhost:3001/api/v1/agent/threads?page=2&pageSize=20')
    assert.equal(calls[2]?.url, `http://localhost:3001/api/v1/agent/threads/${threadId}`)
    assert.equal(calls[3]?.method, 'PATCH')
    assert.equal(calls[3]?.body, JSON.stringify({ title: '新标题' }))
    assert.equal(calls[4]?.method, 'DELETE')
  })

  it('returns a paginated thread list page', async () => {
    const client = createAIGatewayClient({
      fetch: async () =>
        Response.json({
          items: [
            { id: threadId, title: 't', model: 'qwen3.7-plus', createdAt: '', updatedAt: '' },
          ],
          page: 1,
          pageSize: 50,
          total: 1,
          pageCount: 1,
          activeRuns: [
            {
              id: runId,
              threadId,
              status: 'running',
              limitReason: null,
              usage: {
                inputTokens: null,
                outputTokens: null,
                totalTokens: null,
                estimatedCostCny: null,
                usageUnknown: true,
                modelCalls: 0,
                toolCalls: 0,
                webFetchCalls: 0,
              },
              lastSequence: -1,
              createdAt: '',
              startedAt: null,
              completedAt: null,
            },
          ],
        }),
    })
    const page = await client.agent.threads.list()
    assert.equal(page.items.length, 1)
    assert.equal(page.total, 1)
    assert.equal(page.pageSize, 50)
    assert.equal(page.activeRuns.length, 1)
  })

  it('creates and cancels runs', async () => {
    const calls: string[] = []
    const bodies: unknown[] = []
    const client = createAIGatewayClient({
      fetch: async (input, init) => {
        calls.push(`${init?.method} ${String(input)}`)
        bodies.push(init?.body)
        return Response.json({
          id: runId,
          threadId,
          status: 'running',
          limitReason: null,
          usage: {
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            estimatedCostCny: null,
            usageUnknown: false,
            modelCalls: 0,
            toolCalls: 0,
            webFetchCalls: 0,
          },
          lastSequence: -1,
          createdAt: '',
          startedAt: null,
          completedAt: null,
        })
      },
    })

    const run = await client.agent.runs.create(threadId, {
      input: '你好',
      thinkingEffort: 'deep',
      skills: [{ name: 'mock-data-cleaner' }],
    })
    assert.equal(run.status, 'running')
    assert.equal(
      bodies[0],
      JSON.stringify({
        input: '你好',
        thinkingEffort: 'deep',
        skills: [{ name: 'mock-data-cleaner' }],
      }),
    )
    await client.agent.runs.cancel(runId)
    assert.ok(calls[0]?.endsWith(`/api/v1/agent/threads/${threadId}/runs`))
    assert.ok(calls[1]?.endsWith(`/api/v1/agent/runs/${runId}/cancel`))
  })

  it('throws a typed error envelope for conflict responses', async () => {
    const client = createAIGatewayClient({
      fetch: async () =>
        new Response(
          JSON.stringify({
            requestId: runId,
            code: 'CONFLICT',
            message: '已有运行',
            retryable: false,
          }),
          {
            status: 409,
            headers: { 'x-request-id': runId },
          },
        ),
    })
    await assert.rejects(
      () => client.agent.runs.create(threadId, { input: 'x' }),
      (error: unknown) =>
        error instanceof AIGatewayError && error.code === 'CONFLICT' && error.status === 409,
    )
  })
})

describe('AgentClient runs.subscribe', () => {
  it('decodes ordered events and stops at [DONE]', async () => {
    const frames =
      frame({ type: 'run-status', sequence: 0, runId, status: 'running' }) +
      frame({ type: 'message-start', sequence: 1, runId, messageId: 'm1', role: 'assistant' }) +
      frame({ type: 'text-delta', sequence: 2, runId, messageId: 'm1', delta: '答' }) +
      frame({ type: 'run-terminal', sequence: 3, runId, status: 'succeeded', limitReason: null }) +
      'data: [DONE]\n\n'
    const client = createAIGatewayClient({ fetch: async () => sseResponse(frames) })

    const events = await collect(client.agent.runs.subscribe(runId))
    assert.deepEqual(
      events.map((event) => event.sequence),
      [0, 1, 2, 3],
    )
    assert.equal(events.at(-1)?.type, 'run-terminal')
  })

  it('sends the after cursor for reconnect', async () => {
    let requestedUrl = ''
    const client = createAIGatewayClient({
      fetch: async (input) => {
        requestedUrl = String(input)
        return sseResponse(
          frame({
            type: 'run-terminal',
            sequence: 5,
            runId,
            status: 'succeeded',
            limitReason: null,
          }) + 'data: [DONE]\n\n',
        )
      },
    })
    const events = await collect(client.agent.runs.subscribe(runId, { after: 4 }))
    assert.ok(requestedUrl.includes('after=4'))
    assert.equal(events[0]?.sequence, 5)
  })

  it('rejects non-increasing sequences as a protocol error', async () => {
    const frames =
      frame({ type: 'run-status', sequence: 2, runId, status: 'running' }) +
      frame({ type: 'text-delta', sequence: 1, runId, messageId: 'm1', delta: 'x' })
    const client = createAIGatewayClient({ fetch: async () => sseResponse(frames) })
    await assert.rejects(() => collect(client.agent.runs.subscribe(runId)), AIGatewayProtocolError)
  })

  it('propagates AbortSignal to the underlying fetch', async () => {
    const controller = new AbortController()
    let seenSignal: AbortSignal | undefined
    const client = createAIGatewayClient({
      fetch: async (_input, init) => {
        seenSignal = init?.signal ?? undefined
        return sseResponse(
          frame({
            type: 'run-terminal',
            sequence: 0,
            runId,
            status: 'succeeded',
            limitReason: null,
          }) + 'data: [DONE]\n\n',
        )
      },
    })
    await collect(client.agent.runs.subscribe(runId, { signal: controller.signal }))
    assert.equal(seenSignal, controller.signal)
  })
})
