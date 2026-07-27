import type { AddressInfo } from 'node:net'

import type { AIGatewayClient, ChatEvent, ChatMessage } from '@supermind/sdk'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../app.module'
import { configureApplication } from '../configure-app'
import { PrismaService } from '../database/prisma.service'
import { RateLimitExceededException, RateLimitService } from '../rate-limit/rate-limit.service'
import {
  cleanupUserTestData,
  createAuthenticatedClient,
  createAuthenticatedFetch,
  provisionFixtureUserSession,
} from '../user-auth/user-auth.e2e-helpers'

const databaseUrl = process.env.TEST_DATABASE_URL

describe('Mock Chat API/SDK E2E', () => {
  let app: INestApplication
  let baseUrl: string
  let client: AIGatewayClient
  let consumeChat: jest.Mock
  let prisma: PrismaService
  let authenticatedFetch: typeof fetch

  beforeAll(async () => {
    if (!databaseUrl || (!databaseUrl.includes('_test') && !databaseUrl.includes('test_'))) {
      throw new Error('TEST_DATABASE_URL 必须指向名称包含 _test 或 test_ 的 PostgreSQL 测试库')
    }

    consumeChat = jest.fn().mockResolvedValue(undefined)
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RateLimitService)
      .useValue({ consumeChat })
      .compile()
    app = testingModule.createNestApplication()
    configureApplication(app)
    await app.listen(0, '127.0.0.1')

    const address = app.getHttpServer().address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
    prisma = app.get(PrismaService)
  })

  beforeEach(async () => {
    consumeChat.mockReset().mockResolvedValue(undefined)
    await cleanupUserTestData(prisma)
    const sessionToken = await provisionFixtureUserSession(app)
    client = createAuthenticatedClient(baseUrl, sessionToken)
    authenticatedFetch = createAuthenticatedFetch(sessionToken)
  })

  afterAll(async () => {
    if (prisma) {
      await cleanupUserTestData(prisma)
    }
    if (app) await app.close()
  })

  it('streams delta/usage/DONE and persists complete messages with one billing record', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '完整系统提示词' },
      { role: 'user', content: '完整用户问题' },
      { role: 'assistant', content: '完整历史回复' },
      { role: 'user', content: '继续回答' },
    ]
    const events: ChatEvent[] = []

    for await (const event of client.chat.stream({ model: 'qwen', messages, stream: true })) {
      events.push(event)
    }

    const start = events.find((event) => event.type === 'start')
    expect(start?.type).toBe('start')
    if (!start || start.type !== 'start') throw new Error('missing start event')
    expect(
      events
        .filter((event) => event.type === 'delta')
        .map((event) => event.content)
        .join(''),
    ).toBe('这是 Mock Adapter 的确定性流式响应。')
    expect(events.filter((event) => event.type === 'usage')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'done')).toHaveLength(1)

    const requestLog = await prisma.requestLog.findUnique({
      where: { requestId: start.requestId },
      include: { billing: true },
    })
    expect(requestLog).toMatchObject({
      requestId: start.requestId,
      status: 'SUCCEEDED',
      modelAlias: 'qwen',
      provider: 'mock',
      resolvedModel: 'mock-chat-v1',
      prompt: { messages },
    })
    expect(requestLog?.billing).toMatchObject({
      usageUnknown: false,
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
    })
    if (!requestLog) throw new Error('missing persisted request log')
    expect(await prisma.billingRecord.count({ where: { requestLogId: requestLog.id } })).toBe(1)
  })

  it('propagates cancellation and persists a cancelled lifecycle with unknown billing', async () => {
    const abortController = new AbortController()
    const stream = client.chat.stream(
      {
        model: 'qwen',
        messages: [{ role: 'user', content: '取消这个请求' }],
        stream: true,
      },
      { signal: abortController.signal },
    )
    const iterator = stream[Symbol.asyncIterator]()

    const start = await iterator.next()
    expect(start.value?.type).toBe('start')
    const requestId = start.value?.requestId
    expect((await iterator.next()).value?.type).toBe('delta')

    abortController.abort()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })

    const requestLog = await waitForStatus(requestId ?? '', 'CANCELLED')
    expect(requestLog.billing).toMatchObject({
      usageUnknown: true,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    })
  })

  it('trusts only the configured nearest proxy hop when resolving the client IP', async () => {
    const response = await authenticatedFetch(`${baseUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.99, 10.0.0.8',
      },
      body: JSON.stringify({
        model: 'qwen',
        messages: [{ role: 'user', content: '可信代理 IP 验收' }],
        stream: true,
      }),
    })
    await response.text()

    expect(response.status).toBe(200)
    expect(consumeChat).toHaveBeenCalledWith('10.0.0.8')
    const requestId = response.headers.get('x-request-id') ?? ''
    await expect(prisma.requestLog.findUnique({ where: { requestId } })).resolves.toMatchObject({
      clientIp: '10.0.0.8',
    })
  })

  it('returns retry details and creates no request record when rate limited', async () => {
    consumeChat.mockRejectedValueOnce(new RateLimitExceededException(42))

    const response = await authenticatedFetch(`${baseUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen',
        messages: [{ role: 'user', content: '超限请求' }],
        stream: true,
      }),
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('42')
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      details: { retryAfterSeconds: 42 },
    })
    await expect(prisma.requestLog.count()).resolves.toBe(0)
  })

  it('rejects invalid DTO parameters before rate limiting, persistence and adapters', async () => {
    const response = await authenticatedFetch(`${baseUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen',
        messages: [{ role: 'user', content: '非法参数请求' }],
        stream: true,
        temperature: 2.1,
        topP: 1.1,
        maxTokens: 4097,
      }),
    })

    expect(response.status).toBe(400)
    expect(consumeChat).not.toHaveBeenCalled()
    await expect(prisma.requestLog.count()).resolves.toBe(0)
  })

  async function waitForStatus(requestId: string, status: 'CANCELLED') {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const requestLog = await prisma.requestLog.findUnique({
        where: { requestId },
        include: { billing: true },
      })
      if (requestLog?.status === status && requestLog.billing) return requestLog
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`request ${requestId} did not reach ${status}`)
  }
})
