import type { AddressInfo } from 'node:net'

import type { AgentStreamEvent } from '@supermind/sdk'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../app.module'
import { configureApplication } from '../configure-app'
import { PrismaService } from '../database/prisma.service'
import { ChatModelCatalog, type ChatModelDefinition } from '../chat/chat-model-catalog'
import {
  MODEL_INVOCATION_PORT,
  type ModelInvocationPort,
  type ModelInvocationRequest,
} from '../chat/model-invocation.port'
import {
  cleanupUserTestData,
  createAuthenticatedClient,
  provisionFixtureUserSession,
} from '../user-auth/user-auth.e2e-helpers'
import { createOpenSandboxRuntimeTestDouble } from './sandbox/open-sandbox-runtime.test'
import { SANDBOX_RUNTIME_PORT } from './sandbox/sandbox-runtime.port'

const QWEN: ChatModelDefinition = {
  id: 'qwen3.7-plus',
  displayName: 'Qwen3.7-Plus',
  provider: 'qwen',
  upstreamModelId: 'qwen3.7-plus',
  contextWindowTokens: 1_000_000,
}
const GLM: ChatModelDefinition = {
  id: 'glm-5.2',
  displayName: 'GLM-5.2',
  provider: 'glm',
  upstreamModelId: 'glm-5.2',
  contextWindowTokens: 1_000_000,
}

describe('Agent Thread model switching E2E', () => {
  let app: INestApplication
  let baseUrl: string
  let prisma: PrismaService
  let releaseFirstInvocation: (() => void) | undefined
  let signalFirstInvocation: (() => void) | undefined
  const firstInvocationStarted = new Promise<void>((resolve) => {
    signalFirstInvocation = resolve
  })
  const firstInvocationReleased = new Promise<void>((resolve) => {
    releaseFirstInvocation = resolve
  })
  const invocationRequests: ModelInvocationRequest[] = []

  beforeAll(async () => {
    const catalog = {
      list: () => [QWEN, GLM],
      resolve: (id: string) => [QWEN, GLM].find((model) => model.id === id),
      resolveForAgent: (id: string) => [QWEN, GLM].find((model) => model.id === id),
    } as unknown as ChatModelCatalog
    const modelInvocation: ModelInvocationPort = {
      async *invoke(request) {
        const callIndex = invocationRequests.push(request) - 1
        if (callIndex === 0) {
          signalFirstInvocation?.()
          await firstInvocationReleased
        }
        const model = request.modelId === GLM.id ? GLM : QWEN
        yield { type: 'reasoning', delta: `${model.provider}-reasoning` }
        yield { type: 'text', delta: `${model.provider}-answer` }
        yield {
          type: 'usage',
          provider: model.provider,
          resolvedModel: model.upstreamModelId,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            cachedInputTokens: 0,
            reasoningTokens: 2,
            usageUnknown: false,
          },
        }
        yield {
          type: 'finish',
          finishReason: 'stop',
          provider: model.provider,
          resolvedModel: model.upstreamModelId,
        }
      },
    }
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ChatModelCatalog)
      .useValue(catalog)
      .overrideProvider(MODEL_INVOCATION_PORT)
      .useValue(modelInvocation)
      .overrideProvider(SANDBOX_RUNTIME_PORT)
      .useValue(createOpenSandboxRuntimeTestDouble())
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
  })

  afterAll(async () => {
    releaseFirstInvocation?.()
    if (prisma) {
      await prisma.agentThread.deleteMany()
      await cleanupUserTestData(prisma)
    }
    if (app) await app.close()
  })

  it('keeps history in one Thread, snapshots the next model and preserves old billing', async () => {
    const client = createAuthenticatedClient(baseUrl, await provisionFixtureUserSession(app))
    const thread = await client.agent.threads.create({ model: QWEN.id })
    const firstRun = await client.agent.runs.create(thread.id, { input: '先用 Qwen 回答' })
    expect(firstRun).toMatchObject({ model: QWEN.id, provider: QWEN.provider })
    const firstEventsPromise = collectEvents(client.agent.runs.subscribe(firstRun.id))
    const firstStart = await Promise.race([
      firstInvocationStarted.then(() => ({ started: true as const })),
      firstEventsPromise.then((events) => ({ started: false as const, events })),
    ])
    if (!firstStart.started) {
      throw new Error(`Qwen Run 在模型调用前终结：${JSON.stringify(firstStart.events)}`)
    }

    await expect(
      client.agent.threads.updateModel(thread.id, { model: GLM.id }),
    ).rejects.toMatchObject({
        status: 409,
        details: { code: 'AGENT_THREAD_ACTIVE_RUN', activeRunId: firstRun.id },
    })

    releaseFirstInvocation?.()
    await firstEventsPromise
    const beforeSwitch = await client.agent.threads.get(thread.id)
    const messageCount = beforeSwitch.messages.length
    expect(beforeSwitch.model).toBe(QWEN.id)
    expect(beforeSwitch.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user' }),
        expect.objectContaining({
          role: 'assistant',
          parts: expect.arrayContaining([
            { type: 'reasoning', text: 'qwen-reasoning' },
            { type: 'text', text: 'qwen-answer' },
          ]),
        }),
      ]),
    )

    const oldRunBefore = await prisma.agentRun.findUniqueOrThrow({ where: { id: firstRun.id } })
    const oldLogsBefore = await oldRunAudit(prisma, firstRun.id)
    expect(oldLogsBefore).toHaveLength(1)

    const updated = await client.agent.threads.updateModel(thread.id, { model: GLM.id })
    expect(updated).toMatchObject({ id: thread.id, model: GLM.id })
    const afterSwitch = await client.agent.threads.get(thread.id)
    expect(afterSwitch.messages).toHaveLength(messageCount)
    expect(afterSwitch.title).toBe(beforeSwitch.title)
    expect(afterSwitch.contextSummary).toEqual(beforeSwitch.contextSummary)
    expect(afterSwitch.sandbox).toEqual(beforeSwitch.sandbox)

    const secondRun = await client.agent.runs.create(thread.id, { input: '继续同一个任务' })
    expect(secondRun).toMatchObject({ model: GLM.id, provider: GLM.provider })
    const secondEvents = await collectEvents(client.agent.runs.subscribe(secondRun.id))
    expect(secondEvents.at(-1)).toMatchObject({ type: 'run-terminal', status: 'succeeded' })

    const [oldRunAfter, newRun] = await Promise.all([
      prisma.agentRun.findUniqueOrThrow({ where: { id: firstRun.id } }),
      prisma.agentRun.findUniqueOrThrow({ where: { id: secondRun.id } }),
    ])
    expect(oldRunAfter.modelId).toBe(QWEN.id)
    expect(oldRunAfter.provider).toBe(QWEN.provider)
    expect(oldRunAfter.updatedAt).toEqual(oldRunBefore.updatedAt)
    expect(newRun.modelId).toBe(GLM.id)
    expect(newRun.provider).toBe(GLM.provider)
    expect(await oldRunAudit(prisma, firstRun.id)).toEqual(oldLogsBefore)

    expect(invocationRequests.map((request) => request.modelId)).toEqual([QWEN.id, GLM.id])
    const glmHistory = invocationRequests[1]!.messages
    expect(glmHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'assistant', content: 'qwen-answer' })]),
    )
    expect(
      glmHistory.some(
        (message) =>
          message.role === 'assistant' && message.reasoningContent === 'qwen-reasoning',
      ),
    ).toBe(false)
  }, 60_000)
})

async function collectEvents(events: AsyncIterable<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const collected: AgentStreamEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

async function oldRunAudit(prisma: PrismaService, runId: string) {
  const rows = await prisma.requestLog.findMany({
    where: { agentRunId: runId },
    orderBy: { createdAt: 'asc' },
    include: { billing: true },
  })
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    resolvedModel: row.resolvedModel,
    status: row.status,
    billing: row.billing
      ? {
          id: row.billing.id,
          inputTokens: row.billing.inputTokens,
          outputTokens: row.billing.outputTokens,
          totalTokens: row.billing.totalTokens,
          estimatedCostCny: row.billing.estimatedCostCny?.toString() ?? null,
        }
      : null,
  }))
}
