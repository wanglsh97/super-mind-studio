import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createAIGatewayClient } from './client.js'
import { AIGatewayProtocolError } from './errors.js'

describe('createAIGatewayClient models.list', () => {
  it('fetches and returns typed enabled model summaries', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = []
    const models = [
      {
        id: 'qwen3.7-plus',
        alias: 'qwen',
        modelId: 'qwen3.7-plus',
        capabilities: ['agent', 'prompt'],
        displayName: 'Qwen3.7-Plus',
        enabled: true,
        configured: true,
        health: 'unknown',
      },
    ]
    const client = createAIGatewayClient({
      baseUrl: 'http://localhost:3001/',
      fetch: async (fetchInput, init) => {
        calls.push({ input: String(fetchInput), ...(init === undefined ? {} : { init }) })
        return Response.json(models)
      },
    })

    assert.deepEqual(await client.models.list(), models)
    assert.equal(calls[0]?.input, 'http://localhost:3001/api/v1/models')
    assert.equal(calls[0]?.init?.method, 'GET')
  })

  it('rejects malformed model summaries', async () => {
    const client = createAIGatewayClient({
      fetch: async () => Response.json([{ alias: 'secret-provider-model-id' }]),
    })

    await assert.rejects(() => client.models.list(), AIGatewayProtocolError)
  })
})
