import type { PrismaService } from '../database/prisma.service'
import { ConfigService } from '@nestjs/config'
import { ImageTaskStatus } from '../generated/prisma/client'
import type { ImageAdapter, ImageAdapterStatus } from './adapters/image-adapter'
import { ImageAdapterRegistry } from './adapters/image-adapter.registry'
import { ImageService } from './image.service'

const userId = '00000000-0000-4000-8000-000000000101'

const baseTask = {
  id: 'db-task-1',
  taskId: '00000000-0000-4000-8000-000000000120',
  requestLogId: 'log-1',
  userId,
  modelAlias: 'mock-image',
  provider: 'mock',
  providerTaskId: 'provider-task-1',
  status: ImageTaskStatus.RUNNING,
  results: null,
  errorCode: null,
  errorMessage: null,
  createdAt: new Date('2026-07-17T00:00:00.000Z'),
  updatedAt: new Date('2026-07-17T00:00:01.000Z'),
  requestLog: { requestId: '00000000-0000-4000-8000-000000000121' },
}

function setup(tasks: unknown[], status: ImageAdapterStatus = { status: 'running' }) {
  const findFirst = jest.fn()
  for (const task of tasks) findFirst.mockResolvedValueOnce(task)
  const updateManyTask = jest.fn().mockResolvedValue({ count: 1 })
  const updateManyLog = jest.fn().mockResolvedValue({ count: 1 })
  const upsert = jest.fn().mockResolvedValue({})
  const transactionClient = {
    imageGenerationTask: { updateMany: updateManyTask },
    requestLog: { updateMany: updateManyLog },
    billingRecord: { upsert },
  }
  const transaction = jest.fn(async (operation: (client: typeof transactionClient) => unknown) =>
    operation(transactionClient),
  )
  const prisma = {
    imageGenerationTask: { findFirst },
    $transaction: transaction,
  } as unknown as PrismaService
  const getStatus = jest.fn().mockResolvedValue(status)
  const adapter: ImageAdapter = {
    id: 'mock',
    resolvedModel: 'mock-image-v1',
    submit: jest.fn(),
    getStatus,
    download: jest.fn(),
  }
  const service = new ImageService(
    prisma,
    new ImageAdapterRegistry([adapter]),
    new ConfigService({ IMAGE_DOWNLOAD_MAX_BYTES: 1024 }),
  )
  return { adapter, getStatus, service, transaction, updateManyLog, updateManyTask, upsert }
}

describe('ImageService.get', () => {
  it('returns the same 404 when a task is absent or belongs to another user', async () => {
    const { getStatus, service } = setup([null])

    await expect(
      service.get(
        baseTask.taskId,
        '00000000-0000-4000-8000-000000000999',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 404 })
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('returns a persisted terminal task without calling its adapter', async () => {
    const terminal = {
      ...baseTask,
      status: ImageTaskStatus.SUCCEEDED,
      results: [{ url: 'mock://secret', width: 1, height: 1, contentType: 'image/png' }],
    }
    const { getStatus, service, transaction } = setup([terminal])

    await expect(
      service.get(terminal.taskId, userId, new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'succeeded',
      results: [{ index: 0, width: 1, height: 1, contentType: 'image/png' }],
    })
    expect(getStatus).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('polls a non-terminal task and atomically persists a legal terminal transition', async () => {
    const completed = {
      ...baseTask,
      status: ImageTaskStatus.SUCCEEDED,
      results: [{ url: 'mock://image/result', width: 1, height: 1, contentType: 'image/png' }],
    }
    const { getStatus, service, updateManyLog, updateManyTask, upsert } = setup(
      [baseTask, completed],
      {
        status: 'succeeded',
        results: [{ url: 'mock://image/result', width: 1, height: 1, contentType: 'image/png' }],
      },
    )

    await expect(
      service.get(baseTask.taskId, userId, new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'succeeded',
    })
    expect(getStatus).toHaveBeenCalledWith({
      providerTaskId: 'provider-task-1',
      signal: expect.any(AbortSignal),
    })
    expect(updateManyTask).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'db-task-1', status: ImageTaskStatus.RUNNING } }),
    )
    expect(updateManyLog).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'log-1', status: 'PENDING' } }),
    )
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestLogId: 'log-1' } }),
    )
  })

  it('does not call an adapter when a pending task has no persisted provider task ID', async () => {
    const pending = { ...baseTask, status: ImageTaskStatus.PENDING, providerTaskId: null }
    const { getStatus, service } = setup([pending])

    await expect(
      service.get(pending.taskId, userId, new AbortController().signal),
    ).resolves.toMatchObject({ status: 'pending' })
    expect(getStatus).not.toHaveBeenCalled()
  })
})

describe('ImageService.recordSubmission', () => {
  it('atomically persists a synchronous provider terminal result and finishes billing', async () => {
    const task = { ...baseTask, status: ImageTaskStatus.PENDING }
    const updated = {
      ...task,
      providerTaskId: 'mock-sync-request-1',
      status: ImageTaskStatus.SUCCEEDED,
      results: [{ url: 'https://cdn.bigmodel.cn/generated/image.png' }],
    }
    const imageFindFirst = jest.fn().mockResolvedValue(task)
    const imageUpdate = jest.fn().mockResolvedValue(updated)
    const requestUpdate = jest.fn().mockResolvedValue({})
    const billingUpsert = jest.fn().mockResolvedValue({})
    const transactionClient = {
      imageGenerationTask: { findFirst: imageFindFirst, update: imageUpdate },
      requestLog: { update: requestUpdate },
      billingRecord: { upsert: billingUpsert },
    }
    const transaction = jest.fn(async (operation: (client: typeof transactionClient) => unknown) =>
      operation(transactionClient),
    )
    const prisma = { $transaction: transaction } as unknown as PrismaService
    const service = new ImageService(
      prisma,
      new ImageAdapterRegistry([]),
      new ConfigService({ IMAGE_DOWNLOAD_MAX_BYTES: 1024 }),
    )

    await expect(
      service.recordSubmission(task.taskId, userId, {
        providerTaskId: 'mock-sync-request-1',
        status: 'succeeded',
        results: [{ url: 'https://cdn.bigmodel.cn/generated/image.png' }],
      }),
    ).resolves.toEqual(updated)

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(imageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerTaskId: 'mock-sync-request-1',
          status: ImageTaskStatus.SUCCEEDED,
        }),
      }),
    )
    expect(requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED' }) }),
    )
    expect(billingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestLogId: task.requestLogId } }),
    )
  })
})

describe('ImageService.download', () => {
  const terminal = {
    ...baseTask,
    status: ImageTaskStatus.SUCCEEDED,
    results: [{ url: 'mock://image/result' }],
  }

  it('downloads only a whitelisted persisted result through its adapter', async () => {
    const { adapter, service } = setup([terminal])
    ;(adapter.download as jest.Mock).mockResolvedValue({
      body: Uint8Array.from([1, 2, 3]),
      contentType: 'image/png',
    })

    await expect(
      service.download(terminal.taskId, userId, 0, new AbortController().signal),
    ).resolves.toEqual({
      body: Uint8Array.from([1, 2, 3]),
      contentType: 'image/png',
    })
    expect(adapter.download).toHaveBeenCalledWith({
      url: 'mock://image/result',
      signal: expect.any(AbortSignal),
    })
  })

  it('rejects non-terminal tasks and invalid result indexes', async () => {
    const { service: pending } = setup([baseTask])
    await expect(
      pending.download(baseTask.taskId, userId, 0, new AbortController().signal),
    ).rejects.toThrow('只有成功任务')
    const { service } = setup([terminal])
    await expect(
      service.download(terminal.taskId, userId, 2, new AbortController().signal),
    ).rejects.toThrow('index 不存在')
  })

  it('rejects MIME spoofing and oversized provider responses', async () => {
    const spoofed = setup([terminal])
    ;(spoofed.adapter.download as jest.Mock).mockResolvedValue({
      body: Uint8Array.from([1]),
      contentType: 'text/html',
    })
    await expect(
      spoofed.service.download(terminal.taskId, userId, 0, new AbortController().signal),
    ).rejects.toThrow('不支持的图片类型')

    const oversized = setup([terminal])
    ;(oversized.adapter.download as jest.Mock).mockResolvedValue({
      body: new Uint8Array(1025),
      contentType: 'image/png',
    })
    await expect(
      oversized.service.download(terminal.taskId, userId, 0, new AbortController().signal),
    ).rejects.toThrow('超过下载大小限制')
  })
})
