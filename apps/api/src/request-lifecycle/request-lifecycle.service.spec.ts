import { Logger } from '@nestjs/common'

import type { PrismaService } from '../database/prisma.service'
import { RequestStatus } from '../generated/prisma/client'
import {
  type FinishRequestLifecycleInput,
  RequestLifecycleService,
  RequestLifecycleFinishError,
  RequestLifecycleStartError,
  RequestLifecycleTransitionError,
  type StartRequestLifecycleInput,
} from './request-lifecycle.service'

const requestId = '00000000-0000-4000-8000-000000000002'
const startedAt = new Date('2026-07-15T00:00:00.000Z')
const messages = [
  { role: 'system', content: '保留完整系统提示词' },
  { role: 'user', content: '保留完整用户问题' },
  { role: 'assistant', content: '保留完整历史回答' },
]

const input: StartRequestLifecycleInput = {
  userId: '00000000-0000-4000-8000-000000000101',
  requestId,
  capability: 'chat',
  prompt: { messages },
  modelAlias: 'qwen',
  provider: 'mock',
  resolvedModel: 'mock-chat-v1',
  stream: true,
  clientIp: '127.0.0.1',
  metadata: { source: 'unit-test' },
}

function createService() {
  const create = jest.fn()
  const findMany = jest.fn()
  const updateMany = jest.fn()
  const upsert = jest.fn()
  const transaction = jest.fn(async (operation: (client: unknown) => Promise<unknown>) =>
    operation({ requestLog: { updateMany }, billingRecord: { upsert } }),
  )
  const prisma = {
    requestLog: { create, findMany },
    $transaction: transaction,
  } as unknown as PrismaService
  return {
    create,
    findMany,
    service: new RequestLifecycleService(prisma),
    transaction,
    updateMany,
    upsert,
  }
}

describe('RequestLifecycleService.listStalePending', () => {
  it('returns oldest pending summaries before a cutoff without selecting Prompt', async () => {
    const cutoff = new Date('2026-07-15T00:05:00.000Z')
    const { findMany, service } = createService()
    findMany.mockResolvedValue([])

    await expect(service.listStalePending(cutoff, 50)).resolves.toEqual([])
    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', startedAt: { lte: cutoff } },
      orderBy: { startedAt: 'asc' },
      take: 50,
      select: {
        id: true,
        requestId: true,
        capability: true,
        modelAlias: true,
        provider: true,
        startedAt: true,
        createdAt: true,
      },
    })
  })

  it('bounds invalid cutoff and page sizes before querying', async () => {
    const { findMany, service } = createService()

    await expect(service.listStalePending(new Date('invalid'))).rejects.toThrow('valid date')
    await expect(service.listStalePending(new Date(), 201)).rejects.toThrow('between 1 and 200')
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('RequestLifecycleService.start', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('persists the complete messages before returning a pending lifecycle', async () => {
    const { create, service } = createService()
    create.mockResolvedValue({ id: 'log-1', requestId, status: RequestStatus.PENDING, startedAt })

    await expect(service.start(input)).resolves.toEqual({
      id: 'log-1',
      requestId,
      status: RequestStatus.PENDING,
      startedAt,
    })
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: '00000000-0000-4000-8000-000000000101',
        requestId,
        capability: 'CHAT',
        prompt: { messages },
        modelAlias: 'qwen',
        provider: 'mock',
        resolvedModel: 'mock-chat-v1',
        stream: true,
        status: 'PENDING',
        clientIp: '127.0.0.1',
        metadata: { source: 'unit-test' },
      },
      select: { id: true, requestId: true, status: true, startedAt: true },
    })
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      {
        event: 'request.lifecycle.started',
        requestLogId: 'log-1',
        userId: '00000000-0000-4000-8000-000000000101',
        requestId,
        capability: 'chat',
        model: 'qwen',
        provider: 'mock',
        resolvedModel: 'mock-chat-v1',
        stream: true,
        prompt: { messages },
      },
      'Request lifecycle started',
    )
  })

  it('escapes PostgreSQL-incompatible NUL characters in persisted JSON only', async () => {
    const { create, service } = createService()
    create.mockResolvedValue({ id: 'log-1', requestId, status: RequestStatus.PENDING, startedAt })
    const nulInput: StartRequestLifecycleInput = {
      ...input,
      prompt: {
        messages: [{ role: 'tool', content: '搜索结果前\u0000搜索结果后' }],
      },
      metadata: { nested: ['值\u0000尾'] },
    }

    await service.start(nulInput)

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prompt: {
            messages: [{ role: 'tool', content: '搜索结果前\\u0000搜索结果后' }],
          },
          metadata: { nested: ['值\\u0000尾'] },
        }),
      }),
    )
    expect(
      (nulInput.prompt as { messages: Array<{ content: string }> }).messages[0]?.content,
    ).toContain('\u0000')
  })

  it('prevents provider invocation when the pending record cannot be created', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    const { create, service } = createService()
    const invokeProvider = jest.fn()
    create.mockRejectedValue(new Error('database unavailable'))

    const startThenInvokeProvider = async () => {
      await service.start(input)
      invokeProvider()
    }

    await expect(startThenInvokeProvider()).rejects.toBeInstanceOf(RequestLifecycleStartError)
    expect(invokeProvider).not.toHaveBeenCalled()
  })
})

describe('RequestLifecycleService.finish', () => {
  const finishInput: FinishRequestLifecycleInput = {
    requestLogId: 'log-1',
    requestId,
    startedAt,
    completedAt: new Date('2026-07-15T00:00:01.250Z'),
    firstTokenAt: new Date('2026-07-15T00:00:00.100Z'),
    providerRequestId: 'mock-provider-request',
    status: 'succeeded',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      usageUnknown: false,
      priceVersion: 'mock-v1',
      estimatedCostCny: '0.00000000',
    },
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation()
  })

  it('updates RequestLog and upserts its one-to-one BillingRecord in one transaction', async () => {
    const { service, transaction, updateMany, upsert } = createService()
    updateMany.mockResolvedValue({ count: 1 })
    upsert.mockResolvedValue({ id: 'billing-1' })

    await expect(service.finish(finishInput)).resolves.toBeUndefined()

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'log-1', status: 'PENDING' },
      data: expect.objectContaining({
        status: 'SUCCEEDED',
        completedAt: new Date('2026-07-15T00:00:01.250Z'),
        durationMs: 1250,
        firstTokenAt: new Date('2026-07-15T00:00:00.100Z'),
        providerRequestId: 'mock-provider-request',
        errorCode: null,
        errorMessage: null,
      }),
    })
    expect(upsert).toHaveBeenCalledWith({
      where: { requestLogId: 'log-1' },
      create: {
        requestLogId: 'log-1',
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        usageUnknown: false,
        priceVersion: 'mock-v1',
        inputCostCny: null,
        outputCostCny: null,
        estimatedCostCny: '0.00000000',
      },
      update: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        usageUnknown: false,
        priceVersion: 'mock-v1',
        inputCostCny: null,
        outputCostCny: null,
        estimatedCostCny: '0.00000000',
      },
    })
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      {
        event: 'request.lifecycle.finished',
        requestLogId: 'log-1',
        requestId,
        status: 'succeeded',
        durationMs: 1250,
        ttfbMs: 100,
        provider: null,
        resolvedModel: null,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          usageUnknown: false,
        },
        cost: {
          priceVersion: 'mock-v1',
          inputCostCny: null,
          outputCostCny: null,
          estimatedCostCny: '0.00000000',
        },
        failover: null,
        error: null,
      },
      'Request lifecycle finished',
    )
  })

  it.each([
    ['failed', 'FAILED'],
    ['cancelled', 'CANCELLED'],
  ] as const)(
    'supports the %s terminal path with explicit unknown usage',
    async (status, stored) => {
      const { service, updateMany, upsert } = createService()
      updateMany.mockResolvedValue({ count: 1 })
      upsert.mockResolvedValue({ id: 'billing-1' })

      await service.finish({
        requestLogId: 'log-1',
        requestId,
        startedAt,
        completedAt: startedAt,
        status,
        ...(status === 'failed'
          ? { error: { code: 'PROVIDER_FAILED', message: '模型调用失败' } }
          : {}),
      })

      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: stored,
            errorCode: status === 'failed' ? 'PROVIDER_FAILED' : null,
          }),
        }),
      )
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ usageUnknown: true, totalTokens: null }),
        }),
      )
    },
  )

  it('rejects a second terminal transition before writing billing', async () => {
    const { service, updateMany, upsert } = createService()
    updateMany.mockResolvedValue({ count: 0 })

    await expect(service.finish(finishInput)).rejects.toBeInstanceOf(
      RequestLifecycleTransitionError,
    )
    expect(upsert).not.toHaveBeenCalled()
  })

  it('surfaces an atomic transaction failure as unavailable', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    const { service, transaction } = createService()
    transaction.mockRejectedValue(new Error('transaction rolled back'))

    await expect(service.finish(finishInput)).rejects.toBeInstanceOf(RequestLifecycleFinishError)
  })
})
