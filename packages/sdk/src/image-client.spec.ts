import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createSuperMindClient } from './client.js'
import { AIGatewayTimeoutError } from './errors.js'

const pending = { taskId: 'task/1', model: 'mock-image', status: 'pending', results: [] }

describe('SuperMindClient images', () => {
  it('creates and retrieves typed image tasks', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const client = createSuperMindClient({
      baseUrl: 'http://gateway/',
      fetch: async (input, init) => {
        calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
        return Response.json(pending)
      },
    })

    await client.images.create({ model: 'mock-image', prompt: '山水' })
    await client.images.get('task/1')
    assert.equal(calls[0]?.url, 'http://gateway/api/v1/images/generations')
    assert.equal(calls[0]?.init?.method, 'POST')
    assert.equal(calls[0]?.init?.credentials, 'same-origin')
    assert.equal(calls[1]?.url, 'http://gateway/api/v1/images/generations/task%2F1')
  })

  it('polls with backoff and stops at a terminal state', async () => {
    const states = [pending, { ...pending, status: 'running' }, { ...pending, status: 'succeeded' }]
    let calls = 0
    const updates: string[] = []
    const client = createSuperMindClient({
      fetch: async () => Response.json(states[calls++] ?? states.at(-1)),
    })

    const task = await client.images.wait('task-1', {
      intervalMs: 1,
      timeoutMs: 100,
      onUpdate: (update) => updates.push(update.status),
    })
    assert.equal(task.status, 'succeeded')
    assert.equal(calls, 3)
    assert.deepEqual(updates, ['pending', 'running', 'succeeded'])
  })

  it('returns typed timeout without changing the server task', async () => {
    const client = createSuperMindClient({ fetch: async () => Response.json(pending) })
    await assert.rejects(
      () => client.images.wait('task-1', { intervalMs: 1, timeoutMs: 2 }),
      AIGatewayTimeoutError,
    )
  })

  it('supports cancellation while waiting and builds safe proxy download URLs', async () => {
    const controller = new AbortController()
    const client = createSuperMindClient({ fetch: async () => Response.json(pending) })
    const waiting = client.images.wait('task-1', {
      intervalMs: 1_000,
      timeoutMs: 2_000,
      signal: controller.signal,
    })
    controller.abort()
    await assert.rejects(
      waiting,
      (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    )
    assert.equal(
      client.images.downloadUrl('task/1', 0),
      '/api/v1/images/generations/task%2F1/images/0/download',
    )
    assert.throws(() => client.images.downloadUrl('task', -1), TypeError)
  })
})
