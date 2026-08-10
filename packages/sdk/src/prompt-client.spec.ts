import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createSuperMindClient } from './client.js'
import { AIGatewayError, AIGatewayProtocolError } from './errors.js'

const requestId = '00000000-0000-4000-8000-000000000046'

describe('SuperMindClient prompts.optimize', () => {
  it('posts a typed request and parses usage and estimated cost', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const client = createSuperMindClient({
      baseUrl: 'http://gateway/',
      fetch: async (input, init) => {
        calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
        return Response.json(
          {
            requestId,
            model: 'qwen',
            optimizedPrompt: '结构化后的 Prompt',
            templateVersion: '2026-07-v1',
            usage: {
              inputTokens: 12,
              outputTokens: 8,
              totalTokens: 20,
              estimatedCostCny: '0.00012000',
              usageUnknown: false,
            },
          },
          { headers: { 'x-request-id': requestId } },
        )
      },
    })
    const controller = new AbortController()

    const result = await client.prompts.optimize(
      { prompt: '原始 Prompt', mode: 'structure' },
      { signal: controller.signal },
    )

    assert.equal(calls[0]?.url, 'http://gateway/api/v1/prompts/optimize')
    assert.equal(calls[0]?.init?.method, 'POST')
    assert.equal(calls[0]?.init?.body, JSON.stringify({ prompt: '原始 Prompt', mode: 'structure' }))
    assert.equal(calls[0]?.init?.signal, controller.signal)
    assert.deepEqual(result.usage, {
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      estimatedCostCny: '0.00012000',
      usageUnknown: false,
    })
  })

  it('uses the shared typed gateway error parser', async () => {
    const client = createSuperMindClient({
      fetch: async () =>
        Response.json(
          {
            requestId,
            code: 'PROMPT_MODEL_UNAVAILABLE',
            message: '模型未启用',
            retryable: true,
            details: { model: 'qwen' },
          },
          { status: 503 },
        ),
    })

    await assert.rejects(
      () => client.prompts.optimize({ prompt: '原始 Prompt', mode: 'expand' }),
      (error: unknown) =>
        error instanceof AIGatewayError &&
        error.code === 'PROMPT_MODEL_UNAVAILABLE' &&
        error.status === 503 &&
        error.details?.model === 'qwen',
    )
  })

  it('rejects malformed success responses', async () => {
    const client = createSuperMindClient({
      fetch: async () => Response.json({ requestId, model: 'qwen', usage: {} }),
    })

    await assert.rejects(
      () => client.prompts.optimize({ prompt: '原始 Prompt', mode: 'simplify' }),
      AIGatewayProtocolError,
    )
  })
})
