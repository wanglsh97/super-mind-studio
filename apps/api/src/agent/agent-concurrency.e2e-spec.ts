import type { AddressInfo } from 'node:net'

import type { AgentStreamEvent, AIGatewayClient } from '@supermind/sdk'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../app.module'
import { configureApplication } from '../configure-app'
import { PrismaService } from '../database/prisma.service'
import {
  cleanupUserTestData,
  createAuthenticatedClient,
  provisionFixtureUserSession,
} from '../user-auth/user-auth.e2e-helpers'
import { createOpenSandboxRuntimeTestDouble } from './sandbox/open-sandbox-runtime.test'
import {
  SANDBOX_RUNTIME_PORT,
  type CreateSandboxInput,
  type SandboxRuntimePort,
} from './sandbox/sandbox-runtime.port'

describe('Agent cross-Thread concurrency E2E', () => {
  let app: INestApplication
  let baseUrl: string
  let prisma: PrismaService
  let client: AIGatewayClient
  let sandboxArrivals = 0
  let signalBothSandboxesStarted: (() => void) | undefined
  let releaseSandboxCreation: (() => void) | undefined
  const bothSandboxesStarted = new Promise<void>((resolve) => {
    signalBothSandboxesStarted = resolve
  })
  const sandboxCreationReleased = new Promise<void>((resolve) => {
    releaseSandboxCreation = resolve
  })

  beforeAll(async () => {
    const sandbox = createOpenSandboxRuntimeTestDouble()
    const createSandbox = async (input: CreateSandboxInput) => {
      sandboxArrivals += 1
      if (sandboxArrivals === 2) signalBothSandboxesStarted?.()
      await sandboxCreationReleased
      return sandbox.createSandbox(input)
    }
    const concurrentSandbox = new Proxy(sandbox, {
      get(target, property) {
        if (property === 'createSandbox') return createSandbox
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as SandboxRuntimePort
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SANDBOX_RUNTIME_PORT)
      .useValue(concurrentSandbox)
      .compile()
    app = testingModule.createNestApplication()
    configureApplication(app)
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
    prisma = app.get(PrismaService)
  })

  beforeEach(async () => {
    await prisma.agentThread.deleteMany()
    await cleanupUserTestData(prisma)
    client = createAuthenticatedClient(baseUrl, await provisionFixtureUserSession(app))
  })

  afterAll(async () => {
    if (prisma) {
      await prisma.agentThread.deleteMany()
      await cleanupUserTestData(prisma)
    }
    if (app) await app.close()
  })

  it('admits two different Threads, rejects the same Thread and enforces the user limit', async () => {
    const models = await client.models.list()
    const model = models.find(
      (candidate) => candidate.enabled && candidate.capabilities.includes('agent'),
    )
    expect(model).toBeDefined()

    const [threadA, threadB, threadC] = await Promise.all([
      client.agent.threads.create({ model: model!.id }),
      client.agent.threads.create({ model: model!.id }),
      client.agent.threads.create({ model: model!.id }),
    ])
    const [runA, runB] = await Promise.all([
      client.agent.runs.create(threadA.id, { input: '并发任务 A' }),
      client.agent.runs.create(threadB.id, { input: '并发任务 B' }),
    ])
    await bothSandboxesStarted

    expect(runA.threadId).toBe(threadA.id)
    expect(runB.threadId).toBe(threadB.id)

    const listed = await client.agent.threads.list()
    expect(new Set(listed.activeRuns.map((run) => run.threadId))).toEqual(
      new Set([threadA.id, threadB.id]),
    )
    await expect(
      client.agent.runs.create(threadA.id, { input: '同 Thread 重复任务' }),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ code: 'AGENT_THREAD_ACTIVE_RUN' }),
    })
    await expect(
      client.agent.runs.create(threadC.id, { input: '超过用户并发上限' }),
    ).rejects.toMatchObject({
      status: 409,
      details: { code: 'AGENT_USER_CONCURRENCY_LIMIT', limit: 2 },
    })

    await expect(
      prisma.agentRun.count({
        where: { threadId: { in: [threadA.id, threadB.id, threadC.id] } },
      }),
    ).resolves.toBe(2)
    await expect(
      prisma.agentMessage.count({
        where: { threadId: { in: [threadA.id, threadB.id, threadC.id] } },
      }),
    ).resolves.toBe(2)

    releaseSandboxCreation?.()
    const collect = async (runId: string) => {
      const events: AgentStreamEvent[] = []
      for await (const event of client.agent.runs.subscribe(runId)) events.push(event)
      return events
    }
    const [eventsA, eventsB] = await Promise.all([collect(runA.id), collect(runB.id)])
    expect(eventsA.at(-1)).toMatchObject({ type: 'run-terminal', status: 'succeeded' })
    expect(eventsB.at(-1)).toMatchObject({ type: 'run-terminal', status: 'succeeded' })
    expect(eventsA.every((event) => event.runId === runA.id)).toBe(true)
    expect(eventsB.every((event) => event.runId === runB.id)).toBe(true)

    const persistedRuns = await prisma.agentRun.findMany({
      where: { id: { in: [runA.id, runB.id] } },
      orderBy: { id: 'asc' },
    })
    expect(persistedRuns).toHaveLength(2)
    expect(persistedRuns.every((run) => run.status === 'SUCCEEDED')).toBe(true)
    expect(new Set(persistedRuns.map((run) => run.sandboxId)).size).toBe(2)

    const requestLogs = await prisma.requestLog.findMany({
      where: { agentRunId: { in: [runA.id, runB.id] } },
      include: { billing: true },
    })
    expect(requestLogs.some((log) => log.agentRunId === runA.id)).toBe(true)
    expect(requestLogs.some((log) => log.agentRunId === runB.id)).toBe(true)
    expect(
      requestLogs.every((log) => log.agentRunId === runA.id || log.agentRunId === runB.id),
    ).toBe(true)
    expect(requestLogs.every((log) => log.billing !== null)).toBe(true)
  })
})
