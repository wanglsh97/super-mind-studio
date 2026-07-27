import type { AddressInfo } from 'node:net'

import type { AIGatewayClient, ChatCompareRun, ChatEvent } from '@supermind/sdk'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../app.module'
import { configureApplication } from '../configure-app'
import { PrismaService } from '../database/prisma.service'
import { RateLimitService } from '../rate-limit/rate-limit.service'
import {
  cleanupUserTestData,
  createAuthenticatedClient,
  provisionFixtureUserSession,
} from '../user-auth/user-auth.e2e-helpers'
import { ChatAdapterError } from './adapters/chat-adapter'
import type { ChatAdapter, ChatAdapterEvent, ChatAdapterRequest } from './adapters/chat-adapter'
import { CHAT_ADAPTERS } from './adapters/chat-adapter.registry'
import type { ChatAdapterId } from './chat.constants'
import { ProviderHealthService } from './provider-health.service'

const databaseUrl = process.env.TEST_DATABASE_URL

type AdapterMode = 'success' | 'failure' | 'blocked'

class ControllableChatAdapter implements ChatAdapter {
  readonly resolvedModel: string
  mode: AdapterMode = 'success'
  delayMs = 0
  invocations = 0

  constructor(readonly id: ChatAdapterId) {
    this.resolvedModel = `e2e-${id}`
  }

  async *stream(request: ChatAdapterRequest): AsyncIterable<ChatAdapterEvent> {
    this.invocations += 1
    if (this.mode === 'failure') {
      throw new ChatAdapterError(`${this.id} failed before first delta`, {
        code: 'UPSTREAM_503',
        retryable: true,
        statusCode: 503,
      })
    }

    if (this.mode === 'blocked') await waitForAbort(request.signal)
    else await abortableDelay(this.delayMs, request.signal)

    yield { type: 'delta', content: `${this.id}-response` }
    yield {
      type: 'usage',
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, usageUnknown: false },
    }
    yield { type: 'finish', finishReason: 'stop' }
  }

  reset(): void {
    this.mode = 'success'
    this.delayMs = 0
    this.invocations = 0
  }
}

describe('Chat comparison API/SDK E2E', () => {
  let app: INestApplication
  let client: AIGatewayClient
  let baseUrl: string
  let prisma: PrismaService
  const qwen = new ControllableChatAdapter('qwen')
  const glm = new ControllableChatAdapter('glm')
  const deepseek = new ControllableChatAdapter('deepseek')
  const adapters = [qwen, glm, deepseek] as const

  beforeAll(async () => {
    if (!databaseUrl || (!databaseUrl.includes('_test') && !databaseUrl.includes('test_'))) {
      throw new Error('TEST_DATABASE_URL 必须指向名称包含 _test 或 test_ 的 PostgreSQL 测试库')
    }

    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CHAT_ADAPTERS)
      .useValue(adapters)
      .overrideProvider(RateLimitService)
      .useValue({ consumeChat: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(ProviderHealthService)
      .useValue({ recordSuccess: jest.fn(), recordFailure: jest.fn() })
      .compile()
    app = testingModule.createNestApplication()
    configureApplication(app)
    await app.listen(0, '127.0.0.1')

    const address = app.getHttpServer().address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
    prisma = app.get(PrismaService)
  })

  beforeEach(async () => {
    for (const adapter of adapters) adapter.reset()
    await cleanupUserTestData(prisma)
    client = createAuthenticatedClient(baseUrl, await provisionFixtureUserSession(app))
  })

  afterAll(async () => {
    if (prisma) {
      await cleanupUserTestData(prisma)
    }
    if (app) await app.close()
  })

  it('streams three models independently at different speeds', async () => {
    qwen.delayMs = 90
    glm.delayMs = 15
    deepseek.delayMs = 50
    const completionOrder: string[] = []
    const session = createComparison()

    const results = await Promise.all(
      session.runs.map(async (run) => {
        const result = await collect(run)
        completionOrder.push(run.model)
        return result
      }),
    )

    expect(completionOrder).toEqual(['glm', 'deepseek', 'qwen'])
    expect(results.map((result) => result.content)).toEqual([
      'qwen-response',
      'glm-response',
      'deepseek-response',
    ])
    expect(results.every((result) => result.events.some((event) => event.type === 'usage'))).toBe(
      true,
    )
    await expectStatuses(
      results.map((result) => result.requestId),
      ['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED'],
    )
  })

  it('keeps healthy runs alive after one retryable failure and forbids failover', async () => {
    glm.mode = 'failure'
    const session = createComparison()
    const qwenResult = collect(session.runs[0]!)
    const failed = collect(session.runs[1]!)
    const deepseekResult = collect(session.runs[2]!)

    const [failedResult, ...successes] = await Promise.all([failed, qwenResult, deepseekResult])
    expect(failedResult.events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({ code: 'UPSTREAM_503', retryable: true }),
      }),
    )
    expect(successes.map((result) => result.content)).toEqual([
      'qwen-response',
      'deepseek-response',
    ])
    expect(qwen.invocations).toBe(1)
    expect(glm.invocations).toBe(1)
    expect(deepseek.invocations).toBe(1)

    const logs = await waitForLogCount(3)
    expect(logs.map((log) => log.status).sort()).toEqual(['FAILED', 'SUCCEEDED', 'SUCCEEDED'])
    expect(logs.every((log) => !log.failoverFrom && !log.failoverTo && !log.failoverReason)).toBe(
      true,
    )
  })

  it('cancels only one run without interrupting the other models', async () => {
    glm.mode = 'blocked'
    const session = createComparison()
    const glmIterator = session.runs[1]!.events[Symbol.asyncIterator]()
    const glmStart = await glmIterator.next()
    expect(glmStart.value?.type).toBe('start')
    const requestId = glmStart.value?.type === 'start' ? glmStart.value.requestId : ''
    const qwenResult = collect(session.runs[0]!)
    const deepseekResult = collect(session.runs[2]!)

    session.runs[1]!.cancel()
    await expect(glmIterator.next()).rejects.toMatchObject({ name: 'AbortError' })
    const successes = await Promise.all([qwenResult, deepseekResult])
    expect(successes.map((result) => result.content)).toEqual([
      'qwen-response',
      'deepseek-response',
    ])
    await expectStatus(requestId, 'CANCELLED')
  })

  it('cancels all three runs independently', async () => {
    for (const adapter of adapters) adapter.mode = 'blocked'
    const session = createComparison()
    const iterators = session.runs.map((run) => run.events[Symbol.asyncIterator]())
    const starts = await Promise.all(iterators.map((iterator) => iterator.next()))
    const requestIds = starts.map((start) =>
      start.value?.type === 'start' ? start.value.requestId : '',
    )

    session.cancelAll()
    await Promise.all(
      iterators.map((iterator) =>
        expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' }),
      ),
    )
    await expectStatuses(requestIds, ['CANCELLED', 'CANCELLED', 'CANCELLED'])
  })

  function createComparison() {
    return client.chat.compare({
      models: ['qwen', 'glm', 'deepseek'],
      messages: [{ role: 'user', content: '比较三个模型' }],
    })
  }

  async function collect(run: ChatCompareRun) {
    const events: ChatEvent[] = []
    for await (const event of run.events) events.push(event)
    const start = events.find((event) => event.type === 'start')
    if (!start || start.type !== 'start') throw new Error(`missing ${run.model} start event`)
    return {
      requestId: start.requestId,
      events,
      content: events
        .filter((event) => event.type === 'delta')
        .map((event) => event.content)
        .join(''),
    }
  }

  async function expectStatuses(requestIds: string[], statuses: string[]) {
    await Promise.all(
      requestIds.map((requestId, index) => expectStatus(requestId, statuses[index]!)),
    )
  }

  async function expectStatus(requestId: string, status: string) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const log = await prisma.requestLog.findUnique({ where: { requestId } })
      if (log?.status === status) return log
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`request ${requestId} did not reach ${status}`)
  }

  async function waitForLogCount(count: number) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const logs = await prisma.requestLog.findMany({ orderBy: { createdAt: 'asc' } })
      if (logs.length === count && logs.every((log) => log.status !== 'PENDING')) return logs
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`request logs did not reach count ${count}`)
  }
})

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(done, ms)
    const onAbort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    function done() {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(abortError()), { once: true })
  })
}

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError')
}
