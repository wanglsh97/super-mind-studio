import type { AddressInfo } from 'node:net'

import type { AgentStreamEvent, SuperMindClient } from '@supermind/sdk'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../app.module'
import { configureApplication } from '../configure-app'
import { PrismaService } from '../database/prisma.service'
import { ChatModelCatalog, type ChatModelDefinition } from '../chat/chat-model-catalog'
import {
  MODEL_INVOCATION_PORT,
  type ModelInvocationPort,
} from '../chat/model-invocation.port'
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

const TEST_MODEL: ChatModelDefinition = {
  id: 'qwen3.7-plus',
  displayName: 'Qwen3.7-Plus',
  provider: 'qwen',
  upstreamModelId: 'qwen3.7-plus',
  contextWindowTokens: 1_000_000,
}

describe('Agent cross-Thread concurrency E2E', () => {
  let app: INestApplication
  let baseUrl: string
  let prisma: PrismaService
  let client: SuperMindClient
  let sandboxArrivals = 0
  let signalAllSandboxesStarted: (() => void) | undefined
  let releaseSandboxCreation: (() => void) | undefined
  const allSandboxesStarted = new Promise<void>((resolve) => {
    signalAllSandboxesStarted = resolve
  })
  const sandboxCreationReleased = new Promise<void>((resolve) => {
    releaseSandboxCreation = resolve
  })

  beforeAll(async () => {
    const sandbox = createOpenSandboxRuntimeTestDouble()
    const createSandbox = async (input: CreateSandboxInput) => {
      sandboxArrivals += 1
      if (sandboxArrivals === 5) signalAllSandboxesStarted?.()
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
    const catalog = {
      list: () => [TEST_MODEL],
      resolve: (id: string) => (id === TEST_MODEL.id ? TEST_MODEL : undefined),
      resolveForAgent: (id: string) => (id === TEST_MODEL.id ? TEST_MODEL : undefined),
    } as unknown as ChatModelCatalog
    const modelInvocation: ModelInvocationPort = {
      async *invoke() {
        yield { type: 'text', delta: '并发任务完成' }
        yield {
          type: 'usage',
          provider: TEST_MODEL.provider,
          resolvedModel: TEST_MODEL.upstreamModelId,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            usageUnknown: false,
          },
        }
        yield {
          type: 'finish',
          finishReason: 'stop',
          provider: TEST_MODEL.provider,
          resolvedModel: TEST_MODEL.upstreamModelId,
        }
      },
    }
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ChatModelCatalog)
      .useValue(catalog)
      .overrideProvider(MODEL_INVOCATION_PORT)
      .useValue(modelInvocation)
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

  it('admits five different Threads, rejects the same Thread and rejects a sixth before work', async () => {
    const threads = await Promise.all(
      Array.from({ length: 6 }, () => client.agent.threads.create({ model: TEST_MODEL.id })),
    )
    const runs = await Promise.all(
      threads.slice(0, 5).map((thread, index) =>
        client.agent.runs.create(thread.id, { input: `并发任务 ${index + 1}` }),
      ),
    )
    await allSandboxesStarted

    expect(runs.map((run) => run.threadId)).toEqual(threads.slice(0, 5).map((thread) => thread.id))

    const listed = await client.agent.threads.list()
    expect(new Set(listed.activeRuns.map((run) => run.threadId))).toEqual(
      new Set(threads.slice(0, 5).map((thread) => thread.id)),
    )
    await expect(
      client.agent.runs.create(threads[0]!.id, { input: '同 Thread 重复任务' }),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ code: 'AGENT_THREAD_ACTIVE_RUN' }),
    })
    await expect(
      client.agent.runs.create(threads[5]!.id, { input: '第六个并发任务' }),
    ).rejects.toMatchObject({
      status: 409,
      details: { code: 'AGENT_USER_CONCURRENCY_LIMIT', limit: 5 },
    })

    await expect(
      prisma.agentRun.count({
        where: { threadId: { in: threads.map((thread) => thread.id) } },
      }),
    ).resolves.toBe(5)
    await expect(
      prisma.agentMessage.count({
        where: { threadId: { in: threads.map((thread) => thread.id) } },
      }),
    ).resolves.toBe(5)
    await expect(prisma.requestLog.count()).resolves.toBe(0)
    expect(sandboxArrivals).toBe(5)

    releaseSandboxCreation?.()
    const collect = async (runId: string) => {
      const events: AgentStreamEvent[] = []
      for await (const event of client.agent.runs.subscribe(runId)) events.push(event)
      return events
    }
    const eventStreams = await Promise.all(runs.map((run) => collect(run.id)))
    const failures = eventStreams.flatMap((events) =>
      events.filter((event) => event.type === 'error'),
    )
    expect(failures).toEqual([])
    for (const events of eventStreams) {
      expect(events.at(-1)).toMatchObject({ type: 'run-terminal', status: 'succeeded' })
    }
    expect(
      eventStreams.every((events, index) => events.every((event) => event.runId === runs[index]!.id)),
    ).toBe(true)

    const persistedRuns = await prisma.agentRun.findMany({
      where: { id: { in: runs.map((run) => run.id) } },
      orderBy: { id: 'asc' },
    })
    expect(persistedRuns).toHaveLength(5)
    expect(persistedRuns.every((run) => run.status === 'SUCCEEDED')).toBe(true)
    expect(new Set(persistedRuns.map((run) => run.sandboxId)).size).toBe(5)

    const requestLogs = await prisma.requestLog.findMany({
      where: { agentRunId: { in: runs.map((run) => run.id) } },
      include: { billing: true },
    })
    expect(new Set(requestLogs.map((log) => log.agentRunId))).toEqual(
      new Set(runs.map((run) => run.id)),
    )
    expect(requestLogs.every((log) => log.billing !== null)).toBe(true)
  })
})
